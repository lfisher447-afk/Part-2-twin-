'use strict';
module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.status(200).json({
    status: 'ok', version: '4.0.0', runtime: 'vercel',
    region: process.env.VERCEL_REGION || 'iad1',
    ts: new Date().toISOString(),
  });
};
