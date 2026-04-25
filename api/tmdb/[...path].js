'use strict';
// BingeBox Omega 5.1 — /api/tmdb/[...path].js (Production Ready)

const TMDB_KEY = process.env.TMDB_API_KEY;
if (!TMDB_KEY) throw new Error('TMDB_API_KEY env var is not set');
const TMDB_HOST = 'https://api.themoviedb.org/3';

if (!TMDB_KEY) {
  console.warn('CRITICAL: TMDB_API_KEY is missing from environment variables.');
}

// ── L1 Cache (Warm Lambda Memory) ──────────────────────────────────────────
const l1Cache = new Map();
const CACHE_MAX_KEYS = 350;

// Configurable TTLs (in seconds) depending on how fast content becomes stale
const TTL_MAP = new Map([
['/person',     1800],   // 30 mins
['/movie',       600],   // 10 mins
['/tv',          600],   // 10 mins
['/collection', 1800],   // 30 mins
['/discover',    180],   //  3 mins
['/search',       90],   //  1.5 mins
['/trending',     60],   //  1 min
['/Home',     120],   //  1 min
  });
// Determine TTL based on the TMDB path
const getTTL = (path) => {
  for (const [key, ttl] of TTL_MAP.entries()) {
    if (path.includes(key)) return ttl;
  }
  return 300; // Default: 5 minutes fallback
};

// O(1) eviction for the Map (always pops the oldest inserted key)
const enforceCacheLimit = () => {
  if (l1Cache.size >= CACHE_MAX_KEYS) {
    const oldestKey = l1Cache.keys().next().value;
    l1Cache.delete(oldestKey);
  }
};

// ── Concurrency Limiter (Protects against 429s in Batch POST) ──────────────
const pLimit = (concurrency) => {
  let activeCount = 0;
  const queue =[];
  
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

// Max 8 concurrent requests to TMDB to avoid triggering rate limits 
// or exceeding Vercel's 10-second Hobby plan timeout.
const limitTMDB = pLimit(8); 

// ── Core Fetch logic ───────────────────────────────────────────────────────
async function fetchTMDB(tmdbPath, params = {}) {
  // Guarantee the path starts with a slash
  const cleanPath = tmdbPath.startsWith('/') ? tmdbPath : `/${tmdbPath}`;
  
  // URLSearchParams merges safely. Injecting api_key here ensures it cannot be overridden.
  const qs = new URLSearchParams({ ...params, api_key: TMDB_KEY }).toString();
  const url = `${TMDB_HOST}${cleanPath}?${qs}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'BingeBox-Omega/5.1 (Node/Vercel)',
      },
      // Automatically reject if TMDB completely stalls out
      signal: AbortSignal.timeout(7000),
    });

    if (!response.ok) {
      const error = new Error(`TMDB Error: ${response.statusText}`);
      error.status = response.status;
      if (response.status === 429) {
        error.retryAfter = response.headers.get('retry-after') || '5';
      }
      throw error;
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw Object.assign(new Error('TMDB request timed out'), { status: 504 });
    }
    throw err;
  }
}

// ── Main Serverless Handler ────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Set global CORS policy
  res.setHeader('Access-Control-Allow-Origin', '*'); 
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BingeBox-Version');
  
  // Pre-flight check response
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── BATCH POST (Handles Multiple TMDB requests in one call) ──────────────
  if (req.method === 'POST') {
    try {
      // Intelligently parse body whether it's already an object (Vercel) or raw string
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const { requests } = payload;

      if (!Array.isArray(requests) || !requests.length || requests.length > 20) {
        return res.status(400).json({ 
          error: 'bad_request', 
          message: 'Provide exactly 1–20 requests in the payload array.' 
        });
      }

      // Execute all sub-requests bound by the concurrency limiter
      const tasks = requests.map(({ path: p, params }) => 
        limitTMDB(() => fetchTMDB(p, params || {}))
      );
      
      const settled = await Promise.allSettled(tasks);
      
      // Structure format exactly as your UI expects
      return res.status(200).json({
        results: settled.map((r, i) => ({
          path: requests[i].path,
          status: r.status === 'fulfilled' ? 'ok' : 'error',
          data: r.status === 'fulfilled' ? r.value : null,
          error: r.status === 'rejected' ? r.reason.message : null,
        })),
      });
    } catch (err) {
      return res.status(400).json({ error: 'bad_request', message: 'Invalid JSON payload.' });
    }
  }

  // ── GET ROUTE ────────────────────────────────────────────────────────────
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  // Safely extract routing path (Prevents exact-match TypeErrors in various environments)
  let tmdbPath = '';
  if (Array.isArray(req.query?.path)) {
    tmdbPath = `/${req.query.path.join('/')}`;
  } else if (req.query?.path) {
    tmdbPath = `/${req.query.path}`;
  } else {
    // Fallback for standard routing without req.query mapping
    tmdbPath = (req.url || '/').split('?')[0].replace(/^\/api\/tmdb/, '') || '/';
  }

  // Safely extract query parameters & strip out internal args
  const params = { ...(req.query || {}) };
  delete params.path;
  delete params.api_key; 

  const ttlSeconds = getTTL(tmdbPath);
  const cacheKey = `${tmdbPath}?${new URLSearchParams(params).toString()}`;
  const now = Date.now();

  // 1. Check L1 Memory Cache (Fastest)
  const cached = l1Cache.get(cacheKey);
  if (cached && now < cached.expiresAt) {
    res.setHeader('X-BingeBox-L1', 'HIT');
    res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=120`);
    return res.status(200).json(cached.data);
  }

  // 2. Fetch fresh data from TMDB
  try {
    const data = await fetchTMDB(tmdbPath, params);
    
    // Write to L1 Cache securely
    enforceCacheLimit();
    l1Cache.set(cacheKey, { data, expiresAt: now + (ttlSeconds * 1000) });

    res.setHeader('X-BingeBox-L1', 'MISS');
    res.setHeader('Cache-Control', `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}, stale-while-revalidate=120`);
    return res.status(200).json(data);
    
  } catch (err) {
    // Graceful Degradation: If API fails but we have stale cache, Serve Stale!
    if (cached) {
      res.setHeader('X-BingeBox-L1', 'STALE');
      return res.status(200).json(cached.data);
    }

    // Pass along 429 Retry-After rules to clients
    if (err.status === 429) {
      res.setHeader('Retry-After', err.retryAfter || '5');
      return res.status(429).json({ error: 'rate_limited', message: err.message });
    }

    // Complete failure response
    return res.status(err.status || 502).json({ 
      error: 'tmdb_error', 
      message: err.message, 
      path: tmdbPath 
    });
  }
};
