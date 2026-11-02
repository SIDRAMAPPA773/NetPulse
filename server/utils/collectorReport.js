const { getApprovedDiscoveryHosts } = require('./networkSafety');

const MAX_REPORT_BYTES = 64 * 1024;
const MAX_OBSERVATION_AGE_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

function validateCollectorReport(body, subnet, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'observations')) {
    return { error: 'Report must contain only an observations array' };
  }
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_REPORT_BYTES) {
    return { error: 'Report exceeds the 64 KB size limit' };
  }
  const scope = getApprovedDiscoveryHosts(subnet.cidr, [], 256, { requireAllowlist: false });
  if (scope.error) return { error: 'Collector subnet is outside the permitted private subnet scope' };
  if (!Array.isArray(body.observations) || body.observations.length > scope.hosts.length) {
    return { error: `Report must contain at most ${scope.hosts.length} observations` };
  }

  const allowedHosts = new Set(scope.hosts);
  const observedHosts = new Set();
  const observations = [];
  for (const observation of body.observations) {
    const allowedKeys = ['ipAddress', 'reachable', 'latencyMs', 'packetLoss', 'observedAt'];
    if (!observation || typeof observation !== 'object' || Array.isArray(observation)
      || Object.keys(observation).some((key) => !allowedKeys.includes(key))
      || typeof observation.ipAddress !== 'string'
      || !allowedHosts.has(observation.ipAddress)) {
      return { error: 'Report contains an invalid or out-of-scope device address' };
    }
    if (observedHosts.has(observation.ipAddress)) {
      return { error: `Report contains duplicate address ${observation.ipAddress}` };
    }
    if (typeof observation.reachable !== 'boolean'
      || !(observation.latencyMs === null
        || (Number.isFinite(observation.latencyMs) && observation.latencyMs >= 0 && observation.latencyMs <= 600000))
      || !Number.isFinite(observation.packetLoss)
      || observation.packetLoss < 0
      || observation.packetLoss > 100) {
      return { error: `Report contains invalid telemetry for ${observation.ipAddress}` };
    }
    const observedAt = Date.parse(observation.observedAt);
    if (typeof observation.observedAt !== 'string'
      || !Number.isFinite(observedAt)
      || observedAt < now - MAX_OBSERVATION_AGE_MS
      || observedAt > now + MAX_FUTURE_SKEW_MS) {
      return { error: `Report contains an invalid or stale observation time for ${observation.ipAddress}` };
    }
    if (!observation.reachable && observation.latencyMs !== null) {
      return { error: `Unreachable observation ${observation.ipAddress} cannot include a latency value` };
    }

    observedHosts.add(observation.ipAddress);
    observations.push({
      ipAddress: observation.ipAddress,
      reachable: observation.reachable,
      latencyMs: observation.latencyMs,
      packetLoss: observation.reachable ? observation.packetLoss : 100,
      observedAt: new Date(observedAt),
    });
  }

  return { observations };
}

module.exports = {
  MAX_REPORT_BYTES,
  validateCollectorReport,
};
