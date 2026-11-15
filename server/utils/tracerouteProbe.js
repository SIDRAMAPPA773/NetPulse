'use strict';

const { execFile } = require('child_process');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_HOPS = 30;

function parseTracerouteOutput(stdout) {
  const hops = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;
    const hopNumber = Number(match[1]);
    const remainder = match[2];
    const addresses = remainder.match(/(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]{2,}/ig) || [];
    const times = [...remainder.matchAll(/<?\s*(\d+(?:\.\d+)?)\s*ms/ig)]
      .map((item) => Number(item[1]))
      .filter(Number.isFinite);
    hops.push({
      hop: hopNumber,
      address: addresses[0] || null,
      responseTimeMs: times.length ? Math.min(...times) : null,
      responding: addresses.length > 0 && times.length > 0,
    });
  }
  return hops;
}

function runTraceroute(target, options = {}) {
  const maxHops = Number.isInteger(options.maxHops)
    ? Math.max(1, Math.min(options.maxHops, 64))
    : DEFAULT_MAX_HOPS;
  const timeoutMs = Number.isInteger(options.timeoutMs)
    ? Math.max(1000, Math.min(options.timeoutMs, 60000))
    : DEFAULT_TIMEOUT_MS;
  const command = process.platform === 'win32' ? 'tracert' : 'traceroute';
  const args = process.platform === 'win32'
    ? ['-d', '-h', String(maxHops), '-w', String(Math.ceil(timeoutMs / 1000)), target]
    : ['-n', '-m', String(maxHops), '-w', String(Math.ceil(timeoutMs / 1000)), target];

  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const hops = parseTracerouteOutput(stdout);
      const destination = hops.length ? hops[hops.length - 1] : null;
      resolve({
        target,
        status: error && !stdout ? 'UNAVAILABLE' : 'COMPLETED',
        destinationReachable: Boolean(destination?.responding),
        respondingHopCount: hops.filter((hop) => hop.responding).length,
        hops,
        error: error ? (error.killed ? 'Traceroute timed out' : (stderr || error.message)) : null,
      });
    });
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_HOPS,
  parseTracerouteOutput,
  runTraceroute,
};
