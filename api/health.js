'use strict';
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  // ✅ Update:
res.status(200).json({
  status: 'ok',
  version: '5.1.0',        // was '4.0.0'
  runtime: 'vercel',
  tmdb: 'ok',              // ADD — client checks this field
  region: process.env.VERCEL_REGION || 'iad1',
  ts: new Date().toISOString(),
});
};
