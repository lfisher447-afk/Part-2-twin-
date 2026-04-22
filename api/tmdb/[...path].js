'use strict';
// BingeBox Omega 4.0 — /api/tmdb/[...path].js (Vercel Serverless)
const https = require('https');

const TMDB_KEY  = process.env.TMDB_API_KEY || '15d2ea6d0dc1d476efbca3eba2b9bbfb';
const TMDB_HOST = 'api.themoviedb.org';

// Warm lambda cache
const _cache = new Map();

const TTL = [
  ['/genre',    60*60_000], ['/person',   30*60_000],
  ['/movie',    10*60_000], ['/tv',       10*60_000],
  ['/discover',  3*60_000], ['/trending',    60_000],
  ['/search',      90_000], ['/collection', 30*60_000],
];
const getTTL = p => { for (const [k,t] of TTL) if (p.includes(k)) return t; return 5*60_000; };

function prune() {
  if (_cache.size < 400) return;
  const now = Date.now();
  for (const [k,v] of _cache) if (now > v.x) _cache.delete(k);
  if (_cache.size > 300) [..._cache.keys()].slice(0,100).forEach(k=>_cache.delete(k));
}

function tmdb(tmdbPath, params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ api_key: TMDB_KEY, ...params }).toString();
    const opts = {
      hostname: TMDB_HOST, method: 'GET',
      path: `/3${tmdbPath}?${qs}`,
      headers: { Accept: 'application/json', 'User-Agent': 'BingeBox-Omega/4.0' },
      timeout: 7000,
    };
    const req = https.request(opts, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 429) {
          const e = Object.assign(new Error('rate_limited'), { status: 429, retry: res.headers['retry-after'] || '5' });
          return reject(e);
        }
        if (res.statusCode >= 400) return reject(Object.assign(new Error(`TMDB ${res.statusCode}`), { status: res.statusCode }));
        try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error('parse_error'), { status: 502 })); }
      });
    });
    req.on('error', e => reject(Object.assign(e, { status: 502 })));
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('timeout'), { status: 504 })); });
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── BATCH POST ──────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    await new Promise(r => req.on('end', r));
    try {
      const { requests } = JSON.parse(body);
      if (!Array.isArray(requests) || !requests.length || requests.length > 20)
        return res.status(400).json({ error: 'bad_request', message: 'Provide 1–20 requests.' });
      const settled = await Promise.allSettled(requests.map(({ path: p, params }) => tmdb(p, params || {})));
      return res.status(200).json({
        results: settled.map((r, i) => ({
          path: requests[i].path,
          status: r.status === 'fulfilled' ? 'ok' : 'error',
          data: r.status === 'fulfilled' ? r.value : null,
          error: r.status === 'rejected' ? r.reason.message : null,
        })),
      });
    } catch { return res.status(400).json({ error: 'bad_request', message: 'Invalid JSON.' }); }
  }

  if (req.method !== 'GET') return res.status(405).end();

  // ── GET ─────────────────────────────────────────────────────────────────
  const urlObj   = new URL(req.url, 'http://localhost');
  const tmdbPath = urlObj.pathname.replace(/^\/api\/tmdb/, '') || '/';
  const params   = Object.fromEntries(urlObj.searchParams);
  delete params.api_key; // never expose key

  const ttl      = getTTL(tmdbPath);
  const cacheKey = `${tmdbPath}?${new URLSearchParams(params)}`;
  const cached   = _cache.get(cacheKey);

  if (cached && Date.now() < cached.x) {
    res.setHeader('X-BingeBox-Cache', 'HIT');
    res.setHeader('Cache-Control', `public, max-age=${ttl/1000|0}, s-maxage=${ttl/1000|0}, stale-while-revalidate=120`);
    return res.status(200).json(cached.d);
  }

  try {
    const data = await tmdb(tmdbPath, params);
    prune();
    _cache.set(cacheKey, { d: data, x: Date.now() + ttl });
    res.setHeader('X-BingeBox-Cache', 'MISS');
    res.setHeader('Cache-Control', `public, max-age=${ttl/1000|0}, s-maxage=${ttl/1000|0}, stale-while-revalidate=120`);
    return res.status(200).json(data);
  } catch (err) {
    // Serve stale rather than error
    if (cached) {
      res.setHeader('X-BingeBox-Cache', 'STALE');
      return res.status(200).json(cached.d);
    }
    if (err.status === 429) {
      res.setHeader('Retry-After', err.retry || '5');
      return res.status(429).json({ error: 'rate_limited', message: err.message });
    }
    return res.status(err.status || 502).json({ error: 'tmdb_error', message: err.message, path: tmdbPath });
  }
};
