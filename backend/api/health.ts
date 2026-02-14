const ALLOWED_ORIGIN = 'https://stphnmade.github.io';

function setCors(req: any, res: any): boolean {
  const origin = String(req.headers?.origin || '');

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (origin && origin !== ALLOWED_ORIGIN) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'CORS_FORBIDDEN' }));
    return true;
  }

  return false;
}

export default function handler(req: any, res: any) {
  if (setCors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true }));
}
