const dns = require('dns').promises;

const DEFAULT_DNS_TIMEOUT_MS = 2000;

async function resolveHostname(ip, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_DNS_TIMEOUT_MS;
  const startTime = process.hrtime.bigint();

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error('DNS resolution timed out');
      err.code = 'ETIMEOUT';
      reject(err);
    }, timeoutMs);
  });

  try {
    const hostnames = await Promise.race([
      dns.reverse(ip),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle);
    const elapsedNs = process.hrtime.bigint() - startTime;
    const responseTimeMs = Math.round(Number(elapsedNs) / 1e6 * 10) / 10;

    const hostnameList = Array.isArray(hostnames) ? hostnames : [];
    return {
      ipAddress: ip,
      hostname: hostnameList[0] || null,
      hostnames: hostnameList,
      status: hostnameList.length > 0 ? 'RESOLVED' : 'NXDOMAIN',
      responseTimeMs,
      errorReason: hostnameList.length > 0 ? null : 'No reverse PTR record found',
    };
  } catch (err) {
    clearTimeout(timeoutHandle);
    const elapsedNs = process.hrtime.bigint() - startTime;
    const responseTimeMs = Math.round(Number(elapsedNs) / 1e6 * 10) / 10;

    let status = 'ERROR';
    let errorReason = err.message || 'DNS resolution failed';

    if (err.code === 'ENOTFOUND' || err.code === 'NXDOMAIN') {
      status = 'NXDOMAIN';
      errorReason = 'No reverse DNS PTR record exists for this IP';
    } else if (err.code === 'ETIMEOUT' || err.code === 'ETIMEDOUT') {
      status = 'TIMEOUT';
      errorReason = 'Reverse DNS query timed out';
    } else if (err.code === 'ECONNREFUSED') {
      status = 'ERROR';
      errorReason = 'Configured DNS resolver refused query';
    }

    return {
      ipAddress: ip,
      hostname: null,
      hostnames: [],
      status,
      responseTimeMs,
      errorReason,
    };
  }
}

module.exports = {
  DEFAULT_DNS_TIMEOUT_MS,
  resolveHostname,
};
