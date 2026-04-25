'use strict';

/**
 * A serverless function that reports the health of the application and its connection to the TMDB API.
 * This is used by the frontend to detect if it's running in standalone or server-proxied mode.
 */
module.exports = async (req, res) => {
  // Set CORS headers to allow cross-origin requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  let tmdbOk = false;
  try {
    // Ping the TMDB configuration endpoint to verify the API key is valid and the service is reachable.
    const tmdbResponse = await fetch(
      `https://api.themoviedb.org/3/configuration?api_key=${process.env.TMDB_API_KEY}`,
      { signal: AbortSignal.timeout(4000) } // Abort if TMDB doesn't respond within 4 seconds.
    );
    tmdbOk = tmdbResponse.ok;
  } catch (error) {
    // If the fetch fails for any reason (timeout, network error), tmdbOk remains false.
    console.error('TMDB health check failed:', error);
  }

  // Respond with a detailed status object.
  res.status(200).json({
    status: 'ok',
    version: '5.1.0',
    runtime: 'vercel',
    tmdb: tmdbOk ? 'ok' : 'degraded', // The client uses this to determine TMDB connectivity.
    region: process.env.VERCEL_REGION || 'unknown',
    timestamp: new Date().toISOString(),
  });
};
