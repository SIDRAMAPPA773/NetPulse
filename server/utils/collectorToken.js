const crypto = require('node:crypto');
const Collector = require('../models/Collector');
const lastRequestAt = new Map();

function requestIsRateLimited(collectorId, endpoint, now = Date.now()) {
  const key = `${collectorId}:${endpoint}`;
  const lastRequest = lastRequestAt.get(key);
  lastRequestAt.set(key, now);
  if (lastRequest !== undefined && now - lastRequest < 1000) return true;
  if (lastRequestAt.size > 1000) {
    for (const [storedKey, storedAt] of lastRequestAt) {
      if (now - storedAt > 10 * 60 * 1000) lastRequestAt.delete(storedKey);
    }
  }
  return false;
}

function createCollectorToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashCollectorToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function authenticateCollector(req, res, next) {
  const authorization = req.headers.authorization || '';
  const match = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(authorization);
  if (!match) return res.status(401).json({ message: 'A valid collector bearer token is required' });

  try {
    const collector = await Collector.findOne({
      tokenHash: hashCollectorToken(match[1]),
      status: 'active',
    });
    if (!collector) return res.status(401).json({ message: 'Collector token is invalid or revoked' });
    if (requestIsRateLimited(String(collector._id), req.path)) {
      return res.status(429).json({ message: 'Collector request rate limit exceeded' });
    }
    req.collector = collector;
    return next();
  } catch (error) {
    console.error('Collector authentication failed:', error.name || 'UnknownError');
    return res.status(500).json({ message: 'Collector authentication is temporarily unavailable' });
  }
}

module.exports = {
  authenticateCollector,
  createCollectorToken,
  hashCollectorToken,
};
