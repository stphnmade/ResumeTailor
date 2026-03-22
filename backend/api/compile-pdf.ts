import type { VercelRequest, VercelResponse } from "@vercel/node";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ALLOWED_ORIGIN = "https://stphnmade.github.io";
const MAX_TEX_BYTES = 250 * 1024;
const COMPILE_TIMEOUT_MS = 20_000;
const REMOTE_COMPILE_TIMEOUT_MS = 25_000;
const REMOTE_FALLBACK_ENABLED =
  String(process.env.LATEX_REMOTE_FALLBACK || "true").toLowerCase() !== "false";
const LATEXONLINE_BASE_URL = (
  process.env.LATEXONLINE_BASE_URL || "https://texlive2020.latexonline.cc"
).replace(/\/$/, "");
const REMOTE_QUERY_URL_MAX_LEN = 120_000;
const REMOTE_FALLBACK_HOSTS = Array.from(
  new Set([LATEXONLINE_BASE_URL, "https://latexonline.cc"])
);

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function runCommand(
  command: string,
  args: string[],
  workDir: string,
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: workDir });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function runTectonic(workDir: string, texFileName: string): Promise<CommandResult> {
  return runCommand(
    "tectonic",
    ["--keep-logs", "--outdir", workDir, texFileName],
    workDir,
    COMPILE_TIMEOUT_MS
  );
}

function writeTarString(target: Buffer, value: string, offset: number, maxBytes: number) {
  const bytes = Buffer.from(value, "utf8");
  const length = Math.min(bytes.length, maxBytes);
  bytes.copy(target, offset, 0, length);
}

function writeTarOctal(
  target: Buffer,
  value: number,
  offset: number,
  width: number,
  withTrailingSpace = false
) {
  const suffix = withTrailingSpace ? "\0 " : "\0";
  const digits = Math.max(1, width - suffix.length);
  const octal = value.toString(8).slice(-digits).padStart(digits, "0");
  writeTarString(target, `${octal}${suffix}`, offset, width);
}

function buildSingleFileTar(fileName: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512, 0);
  const now = Math.floor(Date.now() / 1000);

  writeTarString(header, fileName, 0, 100);
  writeTarOctal(header, 0o644, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, content.length, 124, 12);
  writeTarOctal(header, now, 136, 12);
  writeTarString(header, "        ", 148, 8);
  writeTarString(header, "0", 156, 1);
  writeTarString(header, "ustar\0", 257, 6);
  writeTarString(header, "00", 263, 2);
  writeTarString(header, "root", 265, 32);
  writeTarString(header, "root", 297, 32);

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarOctal(header, checksum, 148, 8, true);

  const contentPadBytes = (512 - (content.length % 512)) % 512;
  const contentPadding = Buffer.alloc(contentPadBytes, 0);
  const eofPadding = Buffer.alloc(1024, 0);
  return Buffer.concat([header, content, contentPadding, eofPadding]);
}

function normalizeTexForRemoteCompile(tex: string): string {
  return tex
    .replace(/\\\\([&%$#_])/g, (_match, symbol: string) => `\\${symbol}`)
    .replace(/\u2013/g, "--") // en dash
    .replace(/\u2014/g, "---") // em dash
    .replace(/\u2212/g, "-") // minus sign
    .replace(/[\u2018\u2019]/g, "'") // smart single quotes
    .replace(/[\u201C\u201D]/g, '"') // smart double quotes
    .replace(/\u2026/g, "...") // ellipsis
    .replace(/\u00A0/g, " ") // nbsp
    .replace(/\u00AD/g, ""); // soft hyphen
}

async function fetchRemotePdf(url: string, init: RequestInit, label: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_COMPILE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
    });

    const body = Buffer.from(await response.arrayBuffer());
    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (!response.ok) {
      throw new Error(
        `${label} returned ${response.status}: ${body.toString("utf8").slice(0, 8000)}`
      );
    }

    if (!contentType.includes("application/pdf")) {
      throw new Error(
        `${label} did not return PDF (${contentType || "unknown"}): ${body
          .toString("utf8")
          .slice(0, 8000)}`
      );
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function compileWithRemoteDataEndpoint(
  baseUrl: string,
  texFileName: string,
  texBuffer: Buffer
): Promise<Buffer> {
  const archive = buildSingleFileTar(texFileName, texBuffer);
  const form = new FormData();
  form.set(
    "file",
    new Blob([archive], { type: "application/x-tar" }),
    "source.tar"
  );

  const target = encodeURIComponent(texFileName);
  const url = `${baseUrl}/data?target=${target}&command=pdflatex&force=true`;
  return await fetchRemotePdf(url, { method: "POST", body: form }, `${baseUrl}/data`);
}

async function compileWithRemoteQueryEndpoint(baseUrl: string, tex: string): Promise<Buffer> {
  const encodedTex = encodeURIComponent(tex);
  const url = `${baseUrl}/compile?text=${encodedTex}`;
  if (url.length > REMOTE_QUERY_URL_MAX_LEN) {
    throw new Error(
      `${baseUrl}/compile URL exceeds ${REMOTE_QUERY_URL_MAX_LEN} characters (${url.length}).`
    );
  }

  return await fetchRemotePdf(url, { method: "GET" }, `${baseUrl}/compile`);
}

async function compileWithRemoteLatexOnline(workDir: string, texFileName: string): Promise<Buffer> {
  const texPath = path.join(workDir, texFileName);
  const rawTex = (await readFile(texPath)).toString("utf8");
  const tex = normalizeTexForRemoteCompile(rawTex);
  const texBuffer = Buffer.from(tex, "utf8");
  const errors: string[] = [];

  for (const baseUrl of REMOTE_FALLBACK_HOSTS) {
    try {
      return await compileWithRemoteDataEndpoint(baseUrl, texFileName, texBuffer);
    } catch (err: any) {
      errors.push(String(err?.message || err || `${baseUrl}/data failed`));
    }
  }

  for (const baseUrl of REMOTE_FALLBACK_HOSTS) {
    try {
      return await compileWithRemoteQueryEndpoint(baseUrl, tex);
    } catch (err: any) {
      errors.push(String(err?.message || err || `${baseUrl}/compile failed`));
    }
  }

  throw new Error(errors.join("\n"));
}

function trimLog(text: string, maxChars = 12000): string {
  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...<truncated>`;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  let workDir = "";

  try {
    const tex = typeof req.body?.tex === "string" ? req.body.tex : "";

    if (!tex) {
      return res.status(400).json({ error: "Missing input" });
    }

    const texBytes = new TextEncoder().encode(tex).length;
    if (texBytes > MAX_TEX_BYTES) {
      return res.status(400).json({
        error: "INPUT_TOO_LARGE",
        log: `Input .tex exceeds ${MAX_TEX_BYTES} bytes.`,
      });
    }

    workDir = await mkdtemp(path.join(os.tmpdir(), "resume-tailor-"));
    const texPath = path.join(workDir, "resume.tex");
    const pdfPath = path.join(workDir, "resume.pdf");
    const logPath = path.join(workDir, "resume.log");

    await writeFile(texPath, tex, "utf8");

    let result: CommandResult;
    try {
      result = await runTectonic(workDir, "resume.tex");
    } catch (spawnErr: any) {
      const spawnMessage = String(spawnErr?.message || "Failed to start tectonic process.");

      const isMissingTectonic =
        String(spawnErr?.code || "").toUpperCase() === "ENOENT" ||
        /\bENOENT\b/i.test(spawnMessage);

      if (isMissingTectonic && REMOTE_FALLBACK_ENABLED) {
        try {
          const remotePdf = await compileWithRemoteLatexOnline(workDir, "resume.tex");
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", 'attachment; filename="optimized_resume.pdf"');
          return res.end(remotePdf);
        } catch (remoteErr: any) {
          return res.status(500).json({
            error: "LATEX_COMPILE_FAILED",
            log: trimLog(
              `Local compiler missing (tectonic ENOENT). Remote fallback failed.\n${String(
                remoteErr?.message || remoteErr || "Unknown remote compile error"
              )}`
            ),
          });
        }
      }

      return res.status(500).json({
        error: "LATEX_COMPILE_FAILED",
        log: trimLog(
          `Tectonic process failed to start. ${spawnMessage}${
            isMissingTectonic && !REMOTE_FALLBACK_ENABLED
              ? "\nRemote fallback is disabled. Set LATEX_REMOTE_FALLBACK=true to enable remote compile."
              : ""
          }`
        ),
      });
    }

    if (result.timedOut) {
      return res.status(500).json({
        error: "LATEX_COMPILE_FAILED",
        log: trimLog(`Compilation timed out after ${COMPILE_TIMEOUT_MS}ms.\n${result.stderr || result.stdout}`),
      });
    }

    if (result.code !== 0) {
      let latexLog = "";
      try {
        latexLog = await readFile(logPath, "utf8");
      } catch {
        latexLog = "";
      }

      return res.status(500).json({
        error: "LATEX_COMPILE_FAILED",
        log: trimLog(
          [
            `tectonic exited with code ${result.code}${result.signal ? ` (signal: ${result.signal})` : ""}`,
            result.stderr,
            latexLog,
            result.stdout,
          ]
            .filter(Boolean)
            .join("\n\n")
        ),
      });
    }

    const pdf = await readFile(pdfPath);

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="optimized_resume.pdf"');
    return res.end(pdf);
  } catch (err: any) {
    return res.status(500).json({
      error: "LATEX_COMPILE_FAILED",
      log: trimLog(String(err?.message || err || "Unknown compile error")),
    });
  } finally {
    if (workDir) {
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch {
        // no-op
      }
    }
  }
}
