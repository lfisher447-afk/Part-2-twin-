'use strict';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  let tmdbOk = false;
  try {
    const r = await fetch(
      `https://api.themoviedb.org/3/configuration?api_key=${process.env.TMDB_API_KEY}`,
      { signal: AbortSignal.timeout(4000) }
    );
    tmdbOk = r.ok;
  } catch (_) {}

  res.status(200).json({
    status: 'ok',
    version: '5.1.0',      // was '4.0.0'
    runtime: 'vercel',
    tmdb: tmdbOk ? 'ok' : 'degraded',  // ← client reads this
    region: process.env.VERCEL_REGION || 'iad1',
    cacheSize: 0,
    uptime: 0,
    ts: new Date().toISOString(),
  });
};
