import type { VercelRequest, VercelResponse } from "@vercel/node";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ALLOWED_ORIGIN = "https://stphnmade.github.io";
const MAX_TEX_BYTES = 250 * 1024;
const COMPILE_TIMEOUT_MS = 20_000;

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

function runTectonic(workDir: string, texFileName: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const args = ["--keep-logs", "--outdir", workDir, texFileName];
    const child = spawn("tectonic", args, { cwd: workDir });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, COMPILE_TIMEOUT_MS);

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
      return res.status(500).json({
        error: "LATEX_COMPILE_FAILED",
        log: trimLog(`Tectonic process failed to start. ${spawnMessage}`),
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
