const net = require('net');

const DEFAULT_TIMEOUT_MS = 1000;
const MAX_PORTS_PER_PROBE = 10;

const WELL_KNOWN_SERVICES = {
  20: 'FTP-Data',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS-TCP',
  80: 'HTTP',
  110: 'POP3',
  123: 'NTP',
  143: 'IMAP',
  161: 'SNMP',
  389: 'LDAP',
  443: 'HTTPS',
  445: 'SMB',
  636: 'LDAPS',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5900: 'VNC',
  8080: 'HTTP-Alt',
  8443: 'HTTPS-Alt',
};

function getServiceName(port) {
  return WELL_KNOWN_SERVICES[port] || `TCP/${port}`;
}

function probePort(ip, port, timeoutMs = DEFAULT_TIMEOUT_MS, socketFactory = () => new net.Socket()) {
  return new Promise((resolve) => {
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      return resolve({
        port: portNum,
        service: 'Unknown',
        open: false,
        responseTimeMs: null,
        status: 'ERROR',
        error: 'Invalid port number',
      });
    }

    let socket;
    try {
      socket = socketFactory();
    } catch (e) {
      return resolve({
        port: portNum,
        service: getServiceName(portNum),
        open: false,
        responseTimeMs: null,
        status: 'ERROR',
        error: e.message,
      });
    }

    const startTime = process.hrtime.bigint();
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners('connect');
      socket.removeAllListeners('timeout');
      socket.removeAllListeners('error');
      if (typeof socket.destroy === 'function') socket.destroy();
    };

    if (typeof socket.setTimeout === 'function') {
      socket.setTimeout(timeoutMs);
    }

    socket.on('connect', () => {
      if (settled) return;
      settled = true;
      const elapsedNs = process.hrtime.bigint() - startTime;
      const responseTimeMs = Math.round(Number(elapsedNs) / 1e6 * 10) / 10;
      cleanup();
      resolve({
        port: portNum,
        service: getServiceName(portNum),
        open: true,
        responseTimeMs,
        status: 'OPEN',
        error: null,
      });
    });

    socket.on('timeout', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        port: portNum,
        service: getServiceName(portNum),
        open: false,
        responseTimeMs: null,
        status: 'TIMEOUT',
        error: 'Connection timed out',
      });
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      const status = err.code === 'ECONNREFUSED' ? 'CLOSED' : 'FILTERED';
      cleanup();
      resolve({
        port: portNum,
        service: getServiceName(portNum),
        open: false,
        responseTimeMs: null,
        status,
        error: err.code || err.message,
      });
    });

    try {
      socket.connect(portNum, ip);
    } catch (err) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        port: portNum,
        service: getServiceName(portNum),
        open: false,
        responseTimeMs: null,
        status: 'ERROR',
        error: err.message,
      });
    }
  });
}

async function probeServices(ip, ports = [22, 53, 80, 443, 3389], options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const socketFactory = typeof options.socketFactory === 'function' ? options.socketFactory : undefined;
  const targetPorts = Array.from(new Set(ports.map(Number)))
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535)
    .slice(0, MAX_PORTS_PER_PROBE);

  if (targetPorts.length === 0) {
    return {
      reachable: false,
      testedPorts: 0,
      openPorts: [],
      results: [],
    };
  }

  const results = await Promise.all(
    targetPorts.map((port) => probePort(ip, port, timeoutMs, socketFactory))
  );

  const openResults = results.filter((r) => r.open);
  const minResponseTime = openResults.length > 0
    ? Math.min(...openResults.map((r) => r.responseTimeMs))
    : null;

  return {
    reachable: openResults.length > 0,
    testedPorts: results.length,
    openPorts: openResults.map((r) => r.port),
    responseTimeMs: minResponseTime,
    results,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_PORTS_PER_PROBE,
  getServiceName,
  probePort,
  probeServices,
};
