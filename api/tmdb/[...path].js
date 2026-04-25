'use strict';
// BingeBox Omega 5.1 — /api/tmdb/[...path].js (Production Ready)

const TMDB_KEY = process.env.TMDB_API_KEY;
const TMDB_HOST = 'https://api.themoviedb.org/3';

if (!TMDB_KEY) {
  // This will cause the function to fail on startup if the key is missing, which is a good fail-safe.
  throw new Error('CRITICAL: TMDB_API_KEY environment variable is not set.');
}

// ── L1 Cache (In-Memory for Warm Lambdas) ───────────────────────────
const l1Cache = new Map();
const CACHE_MAX_KEYS = 350; // Max number of items to keep in memory to prevent memory leaks.

// Configurable TTLs (in seconds) for different types of API calls.
const TTL_MAP = new Map([
  ['/trending', 60],        //  1 min (very volatile)
  ['/search', 90],          //  1.5 mins
  ['/discover', 180],       //  3 mins
  ['/movie', 600],          // 10 mins
  ['/tv', 600],             // 10 mins
  ['/person', 1800],        // 30 mins (data changes less frequently)
  ['/collection', 1800],    // 30 mins
]);
const getTTL = (path) => {
  for (const [key, ttl] of TTL_MAP.entries()) {
    if (path.startsWith(key)) return ttl;
  }
  return 300; // Default: 5 minutes
};

// Simple FIFO (First-In, First-Out) eviction strategy.
const enforceCacheLimit = () => {
  if (l1Cache.size >= CACHE_MAX_KEYS) {
    const oldestKey = l1Cache.keys().next().value;
    l1Cache.delete(oldestKey);
  }
};

// ── Concurrency Limiter ──────────────────────────────────────────────
const pLimit = (concurrency) => {
  let activeCount = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0 || activeCount >= concurrency) return;
    activeCount++;
    const task = queue.shift();
    task().finally(() => { 
      activeCount--; 
      next(); 
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve).catch(reject));
    next();
  });
};
const limitTMDB = pLimit(8); // Limit to 8 concurrent fetches to avoid 429s from TMDB.

// ── Core Fetch Logic ───────────────────────────────────────────────
async function fetchTMDB(tmdbPath, params = {}) {
  const cleanPath = tmdbPath.startsWith('/') ? tmdbPath : `/${tmdbPath}`;
  const qs = new URLSearchParams({ ...params, api_key: TMDB_KEY }).toString();
  const url = `${TMDB_HOST}${cleanPath}?${qs}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'BingeBox-Omega/5.1 (Vercel)' },
      signal: AbortSignal.timeout(7000), // 7-second timeout.
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const error = new Error(errorBody.status_message || `TMDB Error: ${response.statusText}`);
      error.status = response.status;
      if (response.status === 429) {
        error.retryAfter = response.headers.get('retry-after');
      }
      throw error;
    }
    return await response.json();
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw Object.assign(new Error('TMDB request timed out.'), { status: 504 });
    }
    throw err;
  }
}

// ── Main Serverless Handler ────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS is handled by vercel.json, but this provides a fallback.
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BingeBox-Version, X-Admin-Secret');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // --- BATCH POST (for multiple requests in one call) ---
  if (req.method === 'POST') {
    try {
      if (!Array.isArray(req.body.requests) || req.body.requests.length === 0 || req.body.requests.length > 20) {
        return res.status(400).json({ error: 'bad_request', message: 'Payload must contain a `requests` array with 1-20 items.' });
      }
      const tasks = req.body.requests.map(({ path, params }) => limitTMDB(() => fetchTMDB(path, params || {})));
      const settled = await Promise.allSettled(tasks);
      
      const results = settled.map((r, i) => ({
        path: req.body.requests[i].path,
        status: r.status === 'fulfilled' ? 'ok' : 'error',
        data: r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected' ? r.reason.message : 'Unknown error during batch fetch.',
      }));
      return res.status(200).json({ results });

    } catch (err) {
      return res.status(400).json({ error: 'bad_request', message: 'Invalid JSON payload.' });
    }
  }

  // --- STANDARD GET (for single API calls) ---
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const tmdbPath = `/${(req.query.path || []).join('/')}`;
  const params = { ...req.query };
  delete params.path;

  const ttlSeconds = getTTL(tmdbPath);
  const cacheKey = `${tmdbPath}?${new URLSearchParams(params).toString()}`;
  const now = Date.now();

  const cached = l1Cache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    res.setHeader('X-BingeBox-Cache', 'HIT');
    res.setHeader('Cache-Control', `public, max-age=${Math.round((cached.expiresAt - now) / 1000)}, s-maxage=${Math.round((cached.expiresAt - now) / 1000)}`);
    return res.status(200).json(cached.data);
  }

  try {
    const data = await fetchTMDB(tmdbPath, params);
    
    enforceCacheLimit();
    l1Cache.set(cacheKey, { data, expiresAt: now + (ttlSeconds * 1000) });

    res.setHeader('X-BingeBox-Cache', 'MISS');
    res.setHeader('Cache-Control', `public, s-maxage=${ttlSeconds}, stale-while-revalidate=120`);
    return res.status(200).json(data);
    
  } catch (err) {
    if (cached) { // Serve stale data if available on error
      res.setHeader('X-BingeBox-Cache', 'STALE');
      return res.status(200).json(cached.data);
    }
    if (err.status === 429) {
      res.setHeader('Retry-After', err.retryAfter || '5');
    }
    return res.status(err.status || 502).json({ error: 'tmdb_error', message: err.message, path: tmdbPath });
  }
};
