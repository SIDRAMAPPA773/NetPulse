'use strict';

/**
 * Controlled ICMP probe utility.
 *
 * Runs a bounded number of ICMP echo requests against a single target with a
 * fixed timeout per probe. Produces per-probe round-trip times so the caller
 * can compute min/max/avg/stddev, jitter, packet loss and availability.
 *
 * This module NEVER performs scanning or port probing. It sends exactly the
 * number of echo requests configured by the administrator.
 */

const ping = require('ping');

/**
 * Run N ICMP probes against `ip`.
 *
 * @param {string} ip - IPv4 address to probe.
 * @param {object} [opts]
 * @param {number} [opts.count=5] - number of echo requests.
 * @param {number} [opts.timeout=2] - per-probe timeout in seconds.
 * @param {number} [opts.intervalMs=0] - delay between probes in ms.
 * @returns {Promise<Object>}
 */
const probeIcmp = async (ip, opts = {}) => {
  const count = Math.max(1, Math.min(Number(opts.count) || 5, 20));
  const timeout = Math.max(1, Math.min(Number(opts.timeout) || 2, 30));
  const intervalMs = Math.max(0, Number(opts.intervalMs) || 0);
  const signal = opts.signal;

  const probes = [];
  const start = Date.now();
  let error = null;
  let cancelled = false;

  const isWin = process.platform === 'win32';
  const pingConfig = {
    timeout,
    extra: isWin ? ['-n', '1'] : ['-c', '1'],
  };

  for (let i = 0; i < count; i++) {
    if (signal && signal.aborted) {
      cancelled = true;
      break;
    }
    if (i > 0 && intervalMs > 0) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    if (signal && signal.aborted) {
      cancelled = true;
      break;
    }
    if (typeof opts.beforeProbe === 'function') {
      const permitted = await opts.beforeProbe();
      if (permitted === false) {
        cancelled = true;
        break;
      }
    }
    try {
      const res = await ping.promise.probe(ip, pingConfig);
      if (res.alive) {
        let rtt = null;
        if (res.time !== 'unknown' && res.time !== undefined && !isNaN(parseFloat(res.time))) {
          rtt = parseFloat(res.time);
        }
        probes.push({ rttMs: rtt, success: true });
      } else {
        probes.push({ rttMs: null, success: false });
      }
    } catch (e) {
      probes.push({ rttMs: null, success: false });
      if (!error) error = String(e && e.message ? e.message : e);
    }
  }

  const durationMs = Date.now() - start;
  const successful = probes.filter((p) => p.success);
  const rtts = successful.map((p) => p.rttMs).filter((r) => r !== null && r >= 0);

  const rttMin = rtts.length ? Math.min(...rtts) : null;
  const rttMax = rtts.length ? Math.max(...rtts) : null;
  const rttAvg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;

  let rttStddev = null;
  if (rtts.length > 1) {
    const variance = rtts.reduce((s, r) => s + (r - rttAvg) ** 2, 0) / rtts.length;
    rttStddev = Math.sqrt(variance);
  }

  const attempted = probes.length;
  const packetLoss = attempted > 0 ? Math.round(((attempted - successful.length) / attempted) * 1000) / 10 : null;
  const availability = attempted > 0 ? Math.round((successful.length / attempted) * 1000) / 10 : null;

  return {
    probes,
    reachable: successful.length > 0,
    rttMin,
    rttMax,
    rttAvg: rttAvg !== null ? Math.round(rttAvg * 100) / 100 : null,
    rttStddev: rttStddev !== null ? Math.round(rttStddev * 100) / 100 : null,
    packetLoss,
    availability,
    probeCount: attempted,
    requestedProbeCount: count,
    probeTimeoutMs: timeout * 1000,
    durationMs,
    cancelled,
    error,
  };
};

/**
 * Compute latency jitter between consecutive probes.
 *
 * Jitter is defined here as the mean absolute difference between consecutive
 * RTT samples (RFC 3550 style for one-way delay variation, adapted to RTT).
 * Returns null when fewer than two valid samples exist.
 *
 * @param {{rttMs:number|null,success:boolean}[]} probes
 * @returns {{jitterAvg:number|null,jitterMax:number|null}}
 */
const computeJitter = (probes) => {
  const rtts = [];
  for (const p of probes) {
    if (p.success && p.rttMs !== null && p.rttMs >= 0) rtts.push(p.rttMs);
  }
  if (rtts.length < 2) return { jitterAvg: null, jitterMax: null };
  const diffs = [];
  for (let i = 1; i < rtts.length; i++) {
    diffs.push(Math.abs(rtts[i] - rtts[i - 1]));
  }
  const jitterAvg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const jitterMax = Math.max(...diffs);
  return {
    jitterAvg: Math.round(jitterAvg * 100) / 100,
    jitterMax: Math.round(jitterMax * 100) / 100,
  };
};

module.exports = { probeIcmp, computeJitter };