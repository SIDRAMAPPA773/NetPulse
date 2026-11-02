function clamp(min, max, val) {
  return Math.min(max, Math.max(min, val));
}

const MINIMUM_HEALTH_SCORE_COVERAGE_PERCENT = 70;

function calculateAvailabilityScore(deviceStatus, availabilityPercent) {
  if (Number.isFinite(availabilityPercent)) {
    const score = clamp(0, 100, Math.round(availabilityPercent));
    return { score, coveragePercent: 100, reason: `Probe window availability is ${score}%` };
  }
  if (deviceStatus === 'UNKNOWN') {
    return { score: null, coveragePercent: 0, reason: 'Device reachability has not been verified by a monitoring sample' };
  }
  return {
    score: null,
    coveragePercent: 0,
    reason: deviceStatus === 'DOWN'
      ? 'Device is marked down, but no current availability sample is available'
      : 'No availability sample available; inventory status is not a monitoring sample',
  };
}

function calculatePerformanceScore(latency, packetLoss, jitter) {
  const hasLatency = Number.isFinite(latency) && latency >= 0;
  const hasLoss = Number.isFinite(packetLoss) && packetLoss >= 0;

  const latencyWeight = hasLatency ? 0.55 : 0;
  const lossWeight = hasLoss ? 0.45 : 0;
  const activeWeight = latencyWeight + lossWeight;
  if (activeWeight === 0) {
    return { score: null, coveragePercent: 0, reason: 'No ICMP latency or packet-loss measurements available' };
  }

  let latencyComponent = 100;
  if (hasLatency) {
    if (latency <= 20) latencyComponent = 100;
    else if (latency <= 50) latencyComponent = 90;
    else if (latency <= 100) latencyComponent = 75;
    else if (latency <= 200) latencyComponent = 50;
    else latencyComponent = clamp(0, 50, Math.round(50 - (latency - 200) * 0.2));
  }

  let lossComponent = 100;
  if (hasLoss) {
    lossComponent = clamp(0, 100, Math.round(100 - packetLoss * 2.5));
  }

  let jitterPenalty = 0;
  if (Number.isFinite(jitter) && jitter > 10) {
    jitterPenalty = clamp(0, 20, Math.round((jitter - 10) * 0.5));
  }

  const measuredScore = (
    (hasLatency ? 0.55 * latencyComponent : 0)
    + (hasLoss ? 0.45 * lossComponent : 0)
  ) / activeWeight;
  const coveragePercent = Math.round(activeWeight * 100);
  const score = clamp(0, 100, Math.round(measuredScore - jitterPenalty));
  const explanation = [];
  if (hasLatency) explanation.push(`RTT: ${latency}ms`);
  if (hasLoss) explanation.push(`Loss: ${packetLoss}%`);
  if (Number.isFinite(jitter)) explanation.push(`Jitter: ${jitter}ms`);

  return { score, coveragePercent, reason: explanation.join(' · ') };
}

function calculateTrafficScore(inBps, outBps, speedBps, inErrors, outErrors, inDiscards, outDiscards) {
  const hasThroughput = Number.isFinite(inBps) || Number.isFinite(outBps);
  const hasSpeed = Number.isFinite(speedBps) && speedBps > 0;
  const hasInErrors = Number.isFinite(inErrors);
  const hasOutErrors = Number.isFinite(outErrors);
  const hasInDiscards = Number.isFinite(inDiscards);
  const hasOutDiscards = Number.isFinite(outDiscards);
  const hasErrors = hasInErrors || hasOutErrors;
  const hasDrops = hasInDiscards || hasOutDiscards;
  const coveragePercent = (Number.isFinite(inBps) ? 20 : 0)
    + (Number.isFinite(outBps) ? 20 : 0)
    + (hasSpeed ? 20 : 0)
    + (hasInErrors ? 10 : 0)
    + (hasOutErrors ? 10 : 0)
    + (hasInDiscards ? 10 : 0)
    + (hasOutDiscards ? 10 : 0);

  if (!hasThroughput && !hasErrors && !hasDrops) {
    return { score: null, coveragePercent: 0, reason: 'Interface telemetry or SNMP IF-MIB is not configured' };
  }

  let score = 100;
  const reasons = [];

  if (hasThroughput && hasSpeed) {
    const maxBps = Math.max(inBps || 0, outBps || 0);
    const utilPercent = (maxBps / speedBps) * 100;
    if (utilPercent > 90) {
      score -= 40;
      reasons.push(`High link utilization (${Math.round(utilPercent)}%)`);
    } else if (utilPercent > 75) {
      score -= 20;
      reasons.push(`Moderate link utilization (${Math.round(utilPercent)}%)`);
    } else {
      reasons.push(`Normal link utilization (${Math.round(utilPercent)}%)`);
    }
  } else if (hasThroughput) {
    reasons.push('Throughput collected without advertised interface link speed');
  }

  const totalErrors = (inErrors || 0) + (outErrors || 0);
  if (totalErrors > 0) {
    const penalty = clamp(0, 30, totalErrors * 5);
    score -= penalty;
    reasons.push(`${totalErrors} interface errors detected`);
  }

  const totalDrops = (inDiscards || 0) + (outDiscards || 0);
  if (totalDrops > 0) {
    const penalty = clamp(0, 20, totalDrops * 2);
    score -= penalty;
    reasons.push(`${totalDrops} packets discarded`);
  }

  return {
    score: clamp(0, 100, score),
    coveragePercent,
    reason: reasons.join(' · ') || 'Interface metrics are healthy',
  };
}

function calculateHardwareScore(cpuUtilization, memoryUtilization, temperatureCelsius, temperatureThreshold) {
  const hasCpu = Number.isFinite(cpuUtilization) && cpuUtilization >= 0;
  const hasMem = Number.isFinite(memoryUtilization) && memoryUtilization >= 0;
  const hasTemp = Number.isFinite(temperatureCelsius);
  const coveragePercent = Math.round(((hasCpu ? 1 : 0) + (hasMem ? 1 : 0) + (hasTemp ? 1 : 0)) / 3 * 100);

  if (!hasCpu && !hasMem && !hasTemp) {
    return { score: null, coveragePercent: 0, reason: 'Hardware sensors (CPU, RAM, Temp) not supported or configured via SNMP' };
  }

  let totalScore = 0;
  let count = 0;
  const reasons = [];

  if (hasCpu) {
    let cpuScore = 100;
    if (cpuUtilization > 95) cpuScore = 20;
    else if (cpuUtilization > 85) cpuScore = 50;
    else if (cpuUtilization > 70) cpuScore = 75;
    totalScore += cpuScore;
    count += 1;
    reasons.push(`CPU: ${cpuUtilization}%`);
  }

  if (hasMem) {
    let memScore = 100;
    if (memoryUtilization > 95) memScore = 20;
    else if (memoryUtilization > 85) memScore = 50;
    else if (memoryUtilization > 75) memScore = 75;
    totalScore += memScore;
    count += 1;
    reasons.push(`RAM: ${memoryUtilization}%`);
  }

  if (hasTemp) {
    let tempScore = 100;
    if (Number.isFinite(temperatureThreshold) && temperatureCelsius >= temperatureThreshold) {
      tempScore = 25;
      reasons.push(`Temp: ${temperatureCelsius}°C (exceeds ${temperatureThreshold}°C threshold)`);
    } else {
      reasons.push(`Temp: ${temperatureCelsius}°C`);
    }
    totalScore += tempScore;
    count += 1;
  }

  const score = count > 0 ? clamp(0, 100, Math.round(totalScore / count)) : null;
  return {
    score,
    coveragePercent,
    reason: reasons.join(' · ') || 'Hardware operating normally',
  };
}

function calculateOverallHealthScore({
  deviceStatus = 'UNKNOWN',
  availabilityPercent = null,
  latency = null,
  packetLoss = null,
  jitter = null,
  inBps = null,
  outBps = null,
  speedBps = null,
  inErrors = null,
  outErrors = null,
  inDiscards = null,
  outDiscards = null,
  cpuUtilization = null,
  memoryUtilization = null,
  temperatureCelsius = null,
  temperatureThreshold = null,
}) {
  const availability = calculateAvailabilityScore(deviceStatus, availabilityPercent);
  const performance = calculatePerformanceScore(latency, packetLoss, jitter);
  const traffic = calculateTrafficScore(inBps, outBps, speedBps, inErrors, outErrors, inDiscards, outDiscards);
  const hardware = calculateHardwareScore(cpuUtilization, memoryUtilization, temperatureCelsius, temperatureThreshold);
  const baseWeights = {
    availability: 0.35,
    performance: 0.35,
    traffic: 0.15,
    hardware: 0.15,
  };
  const activeWeights = {
    availability: baseWeights.availability * availability.coveragePercent / 100,
    performance: baseWeights.performance * performance.coveragePercent / 100,
    traffic: baseWeights.traffic * traffic.coveragePercent / 100,
    hardware: baseWeights.hardware * hardware.coveragePercent / 100,
  };
  const activeWeightSum = Object.values(activeWeights).reduce((sum, weight) => sum + weight, 0);
  const coveragePercent = Math.round(activeWeightSum * 100);

  if (deviceStatus === 'DOWN' && availability.score !== null) {
    return {
      overallScore: 0,
      coveragePercent,
      healthStatus: 'Critical',
      components: {
        availability: availability.score,
        performance: performance.score,
        traffic: traffic.score,
        hardware: hardware.score,
      },
      breakdown: [
        { name: 'Availability', score: 0, coveragePercent: availability.coveragePercent, status: 'Critical', reason: availability.reason },
        { name: 'Network Performance', score: performance.score, coveragePercent: performance.coveragePercent, status: performance.score === null ? 'Excluded' : (performance.score >= 80 ? 'Healthy' : performance.score >= 60 ? 'Warning' : 'Critical'), reason: performance.score === null ? 'No ICMP performance sample is available' : performance.reason },
        { name: 'Traffic Health', score: traffic.score, coveragePercent: traffic.coveragePercent, status: traffic.score === null ? 'Excluded' : 'Evaluated', reason: traffic.reason },
        { name: 'Hardware Health', score: hardware.score, coveragePercent: hardware.coveragePercent, status: hardware.score === null ? 'Excluded' : 'Evaluated', reason: hardware.reason },
      ],
      explanation: 'Device is offline and failing reachability probes',
    };
  }

  if (deviceStatus === 'UNKNOWN' && availability.score === null && performance.score === null) {
    return {
      overallScore: null,
      coveragePercent,
      healthStatus: 'Unknown',
      components: {
        availability: null,
        performance: null,
        traffic: traffic.score,
        hardware: hardware.score,
      },
      breakdown: [
        { name: 'Availability', score: null, coveragePercent: availability.coveragePercent, status: 'Unknown', reason: availability.reason },
        { name: 'Network Performance', score: null, coveragePercent: performance.coveragePercent, status: 'Unknown', reason: performance.reason },
        { name: 'Traffic Health', score: traffic.score, coveragePercent: traffic.coveragePercent, status: traffic.score === null ? 'Excluded' : 'Evaluated', reason: traffic.reason },
        { name: 'Hardware Health', score: hardware.score, coveragePercent: hardware.coveragePercent, status: hardware.score === null ? 'Excluded' : 'Evaluated', reason: hardware.reason },
      ],
      explanation: 'Reachability and network performance are unverified; overall health remains unknown',
    };
  }

  // Dynamic weight normalization for available components
  if (activeWeightSum === 0) {
    return {
      overallScore: null,
      coveragePercent: 0,
      healthStatus: 'Unknown',
      components: { availability: null, performance: null, traffic: null, hardware: null },
      breakdown: [],
      explanation: 'No measurable metrics available to generate a health score',
    };
  }

  let weightedScore = 0;
  if (availability.score !== null) weightedScore += availability.score * (activeWeights.availability / activeWeightSum);
  if (performance.score !== null) weightedScore += performance.score * (activeWeights.performance / activeWeightSum);
  if (traffic.score !== null) weightedScore += traffic.score * (activeWeights.traffic / activeWeightSum);
  if (hardware.score !== null) weightedScore += hardware.score * (activeWeights.hardware / activeWeightSum);

  const overallScore = coveragePercent < MINIMUM_HEALTH_SCORE_COVERAGE_PERCENT
    ? null
    : clamp(0, 100, Math.min(Math.round(weightedScore), coveragePercent));

  let healthStatus = overallScore === null ? 'Unknown' : 'Healthy';
  if (overallScore !== null && overallScore < 60) healthStatus = 'Critical';
  else if (overallScore !== null && overallScore < 80) healthStatus = 'Warning';

  const breakdown = [
    {
      name: 'Availability',
      score: availability.score,
      coveragePercent: availability.coveragePercent,
      status: availability.score === null ? 'Excluded' : (availability.score >= 80 ? 'Healthy' : availability.score >= 60 ? 'Warning' : 'Critical'),
      reason: availability.reason,
    },
    {
      name: 'Network Performance',
      score: performance.score,
      coveragePercent: performance.coveragePercent,
      status: performance.score === null ? 'Excluded' : (performance.score >= 80 ? 'Healthy' : performance.score >= 60 ? 'Warning' : 'Critical'),
      reason: performance.reason,
    },
    {
      name: 'Traffic Health',
      score: traffic.score,
      coveragePercent: traffic.coveragePercent,
      status: traffic.score === null ? 'Excluded' : (traffic.score >= 80 ? 'Healthy' : traffic.score >= 60 ? 'Warning' : 'Critical'),
      reason: traffic.reason,
    },
    {
      name: 'Hardware Health',
      score: hardware.score,
      coveragePercent: hardware.coveragePercent,
      status: hardware.score === null ? 'Excluded' : (hardware.score >= 80 ? 'Healthy' : hardware.score >= 60 ? 'Warning' : 'Critical'),
      reason: hardware.reason,
    },
  ];

  return {
    overallScore,
    coveragePercent,
    healthStatus,
    components: {
      availability: availability.score,
      performance: performance.score,
      traffic: traffic.score,
      hardware: hardware.score,
    },
    breakdown,
    explanation: overallScore === null
      ? `Overall health remains Unknown: only ${coveragePercent}% evidence coverage is available; at least ${MINIMUM_HEALTH_SCORE_COVERAGE_PERCENT}% is required`
      : `Score is based on ${breakdown.filter((b) => b.score !== null).length} of 4 metric components (${coveragePercent}% evidence coverage)`,
  };
}

module.exports = {
  calculateAvailabilityScore,
  calculatePerformanceScore,
  calculateTrafficScore,
  calculateHardwareScore,
  calculateOverallHealthScore,
};
