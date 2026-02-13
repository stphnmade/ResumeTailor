const MAX_BODY_BYTES = 350 * 1024;

function setJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  const allowed = [
    'https://stphnmade.github.io',
    'https://stphnmade.github.io/ResumeTailor',
  ];
  if (process.env.NODE_ENV !== 'production') {
    allowed.push('http://localhost:5173');
  }
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const refererAllowed = referer.startsWith('https://stphnmade.github.io/ResumeTailor');
  const originAllowed = allowed.includes(origin) || origin === 'https://stphnmade.github.io' || refererAllowed;

  if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (!originAllowed && origin) {
    setJson(res, 403, { error: 'CORS_FORBIDDEN' });
    return true;
  }

  return false;
}

async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    if (Buffer.byteLength(req.body, 'utf8') > maxBytes) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    return JSON.parse(req.body || '{}');
  }

  const chunks = [];
  let total = 0;

  await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', resolve);
    req.on('error', reject);
  });

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}');
}

module.exports = {
  setJson,
  applyCors,
  readJsonBody,
};
