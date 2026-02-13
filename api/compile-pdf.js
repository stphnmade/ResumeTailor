const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { applyCors, readJsonBody, setJson } = require('./_lib/http');
const { validateResumeTex } = require('./_lib/latex');

const COMPILE_TIMEOUT_MS = 20000;

function runTectonic(texPath, cwd) {
  return new Promise((resolve, reject) => {
    const args = [
      '--keep-logs',
      '--outdir',
      cwd,
      texPath,
    ];

    const child = spawn('tectonic', args, { cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, COMPILE_TIMEOUT_MS);

    child.stdout.on('data', (buf) => {
      stdout += buf.toString('utf8');
    });
    child.stderr.on('data', (buf) => {
      stderr += buf.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error('TECTONIC_TIMEOUT'));
        return;
      }
      if (code !== 0) {
        const log = `${stdout}\n${stderr}`.trim();
        reject(new Error(log || 'TECTONIC_FAILED'));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    setJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req, 260 * 1024);
  } catch (err) {
    if (String(err.message || '').includes('PAYLOAD_TOO_LARGE')) {
      setJson(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      return;
    }
    setJson(res, 400, { error: 'INVALID_JSON_BODY' });
    return;
  }

  const tex = body?.tex;
  try {
    validateResumeTex(tex);
  } catch (err) {
    setJson(res, 400, { error: String(err.message || 'LATEX_INVALID') });
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resume-tailor-'));
  const texPath = path.join(tmpDir, 'resume.tex');
  const pdfPath = path.join(tmpDir, 'resume.pdf');

  try {
    await fs.writeFile(texPath, tex, 'utf8');

    await runTectonic(texPath, tmpDir);

    const pdf = await fs.readFile(pdfPath);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="optimized_resume.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    res.end(pdf);
  } catch (err) {
    let log = String(err.message || 'LATEX_COMPILE_FAILED');
    if (log.length > 12000) {
      log = log.slice(-12000);
    }

    setJson(res, 400, {
      error: 'LATEX_COMPILE_FAILED',
      log,
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};
