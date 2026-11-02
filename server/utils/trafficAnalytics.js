/**
 * NetPulse Advanced Traffic & Interface Rate Analytics
 * 
 * Provides mathematically accurate bandwidth, packet rate, error rate,
 * discard rate, and interface utilization calculations.
 * 
 * Accurately handles:
 * - 32-bit counter rollover (2^32)
 * - 64-bit high-capacity counter rollover (2^64)
 * - Counter resets, interface restarts, and device reboots (sysUpTime reset)
 * - Stale counter intervals and missing samples
 * - Interface index or speed changes
 */

const MODULUS_32 = 4294967296n; // 2^32
const MODULUS_64 = 18446744073709551616n; // 2^64
const MAX_VALID_ELAPSED_SECONDS = 900; // 15 minutes max between continuous samples
const MIN_VALID_ELAPSED_SECONDS = 0.5; // Half second min to prevent division by zero or extreme spikes

/**
 * Normalizes an SNMP counter value to a non-negative BigInt or null if invalid.
 */
function toBigIntCounter(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return val >= 0n ? val : null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val < 0) return null;
    return BigInt(Math.floor(val));
  }
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    try {
      return BigInt(val.trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Calculates counter delta between two successive observations with rollover & reset detection.
 * 
 * @param {number|string|bigint} prevVal Previous counter value
 * @param {number|string|bigint} currVal Current counter value
 * @param {number} elapsedSeconds Elapsed time in seconds
 * @param {number} widthBits Counter bit-width: 32 or 64
 * @param {boolean} [sysUpTimeDecreased=false] True if device rebooted or interface restarted
 * @returns {{ delta: number|null, rolledOver: boolean, reset: boolean, reason: string|null }}
 */
function calculateCounterDelta(prevVal, currVal, elapsedSeconds, widthBits = 64, sysUpTimeDecreased = false) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < MIN_VALID_ELAPSED_SECONDS || elapsedSeconds > MAX_VALID_ELAPSED_SECONDS) {
    return { delta: null, rolledOver: false, reset: false, reason: 'Invalid or stale elapsed time interval' };
  }

  const prev = toBigIntCounter(prevVal);
  const curr = toBigIntCounter(currVal);

  if (prev === null || curr === null) {
    return { delta: null, rolledOver: false, reset: false, reason: 'Missing or malformed counter sample' };
  }

  if (sysUpTimeDecreased) {
    return { delta: null, rolledOver: false, reset: true, reason: 'System reboot or counter reset detected' };
  }

  // Normal monotonic increment
  if (curr >= prev) {
    const diff = curr - prev;
    return { delta: Number(diff), rolledOver: false, reset: false, reason: null };
  }

  // Counter decreased: test for legitimate rollover
  const modulus = widthBits === 32 ? MODULUS_32 : MODULUS_64;
  
  // Valid rollover check: previous counter must be near top 20% and current near bottom 20%
  const upperThreshold = (modulus * 8n) / 10n;
  const lowerThreshold = (modulus * 2n) / 10n;

  if (prev >= upperThreshold && curr <= lowerThreshold) {
    const diff = (modulus - prev) + curr;
    return { delta: Number(diff), rolledOver: true, reset: false, reason: `Rollover detected on ${widthBits}-bit counter` };
  }

  // If not near threshold, counter was reset, cleared, or interface restarted
  return { delta: null, rolledOver: false, reset: true, reason: 'Counter reset or interface index recycled' };
}

/**
 * Calculates bandwidth in bits per second (bps) from octet delta.
 */
function calculateBandwidthBps(deltaOctets, elapsedSeconds) {
  if (!Number.isFinite(deltaOctets) || deltaOctets < 0 || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return null;
  }
  return Number(((deltaOctets * 8) / elapsedSeconds).toFixed(2));
}

/**
 * Calculates rate in packets per second (pps) from packet delta.
 */
function calculatePacketRatePps(deltaPackets, elapsedSeconds) {
  if (!Number.isFinite(deltaPackets) || deltaPackets < 0 || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return null;
  }
  return Number((deltaPackets / elapsedSeconds).toFixed(2));
}

/**
 * Calculates interface utilization percentage given throughput in bps and interface speed in bps.
 * Returns null if speed is unknown or <= 0. Clamped to 0 - 100%.
 */
function calculateInterfaceUtilization(throughputBps, speedBps) {
  if (!Number.isFinite(throughputBps) || throughputBps < 0 || !Number.isFinite(speedBps) || speedBps <= 0) {
    return null;
  }
  const util = (throughputBps / speedBps) * 100;
  return Number(Math.min(100, Math.max(0, util)).toFixed(2));
}

/**
 * Computes full traffic analytics given previous and current interface sample snapshots.
 * 
 * @param {object} prev Previous metric sample
 * @param {object} curr Current metric sample
 * @param {number} elapsedSeconds Elapsed seconds between samples
 * @param {object} options Options such as interfaceSpeedBps, sysUpTimeDecreased
 * @returns {object} Comprehensive traffic analytics object
 */
function computeInterfaceTrafficMetrics(prev = {}, curr = {}, elapsedSeconds, options = {}) {
  const { interfaceSpeedBps = null, sysUpTimeDecreased = false, is64Bit = true } = options;
  const widthBits = is64Bit ? 64 : 32;

  // Fallback to 32-bit if 64-bit HC counters are not present
  const prevInOctets = prev.inOctetsHC || prev.inOctets;
  const currInOctets = curr.inOctetsHC || curr.inOctets;
  const prevOutOctets = prev.outOctetsHC || prev.outOctets;
  const currOutOctets = curr.outOctetsHC || curr.outOctets;

  const inDeltaRes = calculateCounterDelta(prevInOctets, currInOctets, elapsedSeconds, widthBits, sysUpTimeDecreased);
  const outDeltaRes = calculateCounterDelta(prevOutOctets, currOutOctets, elapsedSeconds, widthBits, sysUpTimeDecreased);

  const inBps = inDeltaRes.delta !== null ? calculateBandwidthBps(inDeltaRes.delta, elapsedSeconds) : null;
  const outBps = outDeltaRes.delta !== null ? calculateBandwidthBps(outDeltaRes.delta, elapsedSeconds) : null;

  // Packets
  const prevInPkts = prev.inPacketsHC || prev.inPackets;
  const currInPkts = curr.inPacketsHC || curr.inPackets;
  const prevOutPkts = prev.outPacketsHC || prev.outPackets;
  const currOutPkts = curr.outPacketsHC || curr.outPackets;

  const inPktDelta = calculateCounterDelta(prevInPkts, currInPkts, elapsedSeconds, widthBits, sysUpTimeDecreased);
  const outPktDelta = calculateCounterDelta(prevOutPkts, currOutPkts, elapsedSeconds, widthBits, sysUpTimeDecreased);

  const inPps = inPktDelta.delta !== null ? calculatePacketRatePps(inPktDelta.delta, elapsedSeconds) : null;
  const outPps = outPktDelta.delta !== null ? calculatePacketRatePps(outPktDelta.delta, elapsedSeconds) : null;

  // Errors and Discards (always 32-bit standard counters)
  const inErrDelta = calculateCounterDelta(prev.inErrors, curr.inErrors, elapsedSeconds, 32, sysUpTimeDecreased);
  const outErrDelta = calculateCounterDelta(prev.outErrors, curr.outErrors, elapsedSeconds, 32, sysUpTimeDecreased);
  const inDiscDelta = calculateCounterDelta(prev.inDiscards, curr.inDiscards, elapsedSeconds, 32, sysUpTimeDecreased);
  const outDiscDelta = calculateCounterDelta(prev.outDiscards, curr.outDiscards, elapsedSeconds, 32, sysUpTimeDecreased);

  const inErrorRate = inErrDelta.delta !== null ? Number((inErrDelta.delta / elapsedSeconds).toFixed(2)) : null;
  const outErrorRate = outErrDelta.delta !== null ? Number((outErrDelta.delta / elapsedSeconds).toFixed(2)) : null;
  const inDiscardRate = inDiscDelta.delta !== null ? Number((inDiscDelta.delta / elapsedSeconds).toFixed(2)) : null;
  const outDiscardRate = outDiscDelta.delta !== null ? Number((outDiscDelta.delta / elapsedSeconds).toFixed(2)) : null;

  // Utilization
  const inUtil = inBps !== null && interfaceSpeedBps ? calculateInterfaceUtilization(inBps, interfaceSpeedBps) : null;
  const outUtil = outBps !== null && interfaceSpeedBps ? calculateInterfaceUtilization(outBps, interfaceSpeedBps) : null;
  const overallUtil = (inUtil !== null || outUtil !== null) ? Math.max(inUtil || 0, outUtil || 0) : null;

  return {
    elapsedSeconds,
    inOctetsDelta: inDeltaRes.delta,
    outOctetsDelta: outDeltaRes.delta,
    inBps,
    outBps,
    inPacketsDelta: inPktDelta.delta,
    outPacketsDelta: outPktDelta.delta,
    inPps,
    outPps,
    inErrorsDelta: inErrDelta.delta,
    outErrorsDelta: outErrDelta.delta,
    inErrorRate,
    outErrorRate,
    inDiscardsDelta: inDiscDelta.delta,
    outDiscardsDelta: outDiscDelta.delta,
    inDiscardRate,
    outDiscardRate,
    interfaceSpeedBps,
    inUtilization: inUtil,
    outUtilization: outUtil,
    overallUtilization: overallUtil,
    counterReset: inDeltaRes.reset || outDeltaRes.reset,
    counterRolledOver: inDeltaRes.rolledOver || outDeltaRes.rolledOver,
    unavailabilityReason: inDeltaRes.reason || outDeltaRes.reason || null,
  };
}

module.exports = {
  calculateCounterDelta,
  calculateBandwidthBps,
  calculatePacketRatePps,
  calculateInterfaceUtilization,
  computeInterfaceTrafficMetrics,
};
