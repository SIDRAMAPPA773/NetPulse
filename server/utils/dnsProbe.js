const dns = require('dns').promises;

const DEFAULT_DNS_TIMEOUT_MS = 2000;

function probeDnsQuery(server, domain, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs)
    ? Math.max(100, Math.min(options.timeoutMs, 10000))
    : DEFAULT_DNS_TIMEOUT_MS;
  const resolver = new dns.Resolver();
  try {
    resolver.setServers([server]);
  } catch (error) {
    return Promise.resolve({
      server,
      domain,
      status: 'INVALID',
      responseTimeMs: null,
      addresses: [],
      errorReason: error.code || error.message,
    });
  }
  const startTime = process.hrtime.bigint();
  let timer;
  const query = new Promise((resolve) => {
    timer = setTimeout(() => resolve({
      server,
      domain,
      status: 'TIMEOUT',
      responseTimeMs: Math.round(Number(process.hrtime.bigint() - startTime) / 1e6 * 10) / 10,
      addresses: [],
      errorReason: 'DNS query timed out',
    }), timeoutMs);
    resolver.resolve4(domain, (error, addresses) => {
      if (error) {
        clearTimeout(timer);
        const status = error.code === 'ENOTFOUND' ? 'NXDOMAIN'
          : error.code === 'ESERVFAIL' ? 'SERVFAIL'
            : error.code === 'EREFUSED' ? 'REFUSED' : 'ERROR';
        return resolve({
          server,
          domain,
          status,
          responseTimeMs: Math.round(Number(process.hrtime.bigint() - startTime) / 1e6 * 10) / 10,
          addresses: [],
          errorReason: error.code || error.message,
        });
      }
      clearTimeout(timer);
      return resolve({
        server,
        domain,
        status: 'RESOLVED',
        responseTimeMs: Math.round(Number(process.hrtime.bigint() - startTime) / 1e6 * 10) / 10,
        addresses: Array.isArray(addresses) ? addresses : [],
        errorReason: null,
      });
    });
  });
  return query;
}

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

async function probeDnsIntelligence(ip, options = {}) {
  const reverseResult = await resolveHostname(ip, options);
  let forwardMatchesReverse = null;
  let isInconsistent = false;
  let inconsistencyReason = null;
  let forwardIps = [];

  if (reverseResult.status === 'RESOLVED' && reverseResult.hostname && options.checkForward !== false) {
    const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_DNS_TIMEOUT_MS;
    try {
      let timeoutHandle;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const err = new Error('Forward DNS lookup timed out');
          err.code = 'ETIMEOUT';
          reject(err);
        }, timeoutMs);
      });

      const forwardAddresses = await Promise.race([
        dns.resolve(reverseResult.hostname).catch(() => dns.lookup(reverseResult.hostname).then((res) => (res.address ? [res.address] : []))),
        timeoutPromise,
      ]);
      clearTimeout(timeoutHandle);

      forwardIps = Array.isArray(forwardAddresses) ? forwardAddresses : [];
      if (forwardIps.length > 0) {
        forwardMatchesReverse = forwardIps.includes(ip);
        if (!forwardMatchesReverse) {
          isInconsistent = true;
          inconsistencyReason = `Reverse PTR ${reverseResult.hostname} forwards to ${forwardIps.join(', ')} rather than queried IP ${ip}`;
        }
      }
    } catch {
      // Forward lookup failed; reverse is still valid but forward check is inconclusive
      forwardMatchesReverse = null;
    }
  }

  return {
    ...reverseResult,
    ptr: reverseResult.hostname,
    resolvedIps: forwardIps,
    forwardMatchesReverse,
    isInconsistent,
    inconsistencyReason,
  };
}

module.exports = {
  DEFAULT_DNS_TIMEOUT_MS,
  probeDnsQuery,
  resolveHostname,
  probeDnsIntelligence,
};
