function calculatePercentile(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return null;
  if (percentile <= 0) return sortedValues[0];
  if (percentile >= 100) return sortedValues[sortedValues.length - 1];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return sortedValues[lower];
  return Math.round((sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight) * 100) / 100;
}

function calculateMedian(sortedValues) {
  return calculatePercentile(sortedValues, 50);
}

function computeLatencyMetrics(rttSamples = []) {
  const validSamples = rttSamples
    .map((val) => (typeof val === 'object' && val !== null ? val.rttMs : val))
    .filter((val) => typeof val === 'number' && Number.isFinite(val) && val >= 0);

  if (validSamples.length === 0) {
    return {
      current: null,
      min: null,
      max: null,
      avg: null,
      median: null,
      p95: null,
      p99: null,
      jitter: null,
      stddev: null,
      sampleCount: 0,
    };
  }

  const sorted = [...validSamples].sort((a, b) => a - b);
  const sum = validSamples.reduce((acc, val) => acc + val, 0);
  const avg = Math.round((sum / validSamples.length) * 100) / 100;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const current = validSamples[validSamples.length - 1];
  const median = calculateMedian(sorted);
  const p95 = calculatePercentile(sorted, 95);
  const p99 = calculatePercentile(sorted, 99);

  // Compute standard deviation
  let variance = 0;
  for (const sample of validSamples) {
    variance += (sample - avg) ** 2;
  }
  const stddev = validSamples.length > 1
    ? Math.round(Math.sqrt(variance / (validSamples.length - 1)) * 100) / 100
    : 0;

  // Compute jitter (RFC 3550 style or mean absolute difference)
  let diffSum = 0;
  for (let i = 1; i < validSamples.length; i++) {
    diffSum += Math.abs(validSamples[i] - validSamples[i - 1]);
  }
  const jitter = validSamples.length > 1
    ? Math.round((diffSum / (validSamples.length - 1)) * 100) / 100
    : 0;

  return {
    current,
    min,
    max,
    avg,
    median,
    p95,
    p99,
    jitter,
    stddev,
    sampleCount: validSamples.length,
  };
}

function computePacketLossMetrics({
  rawProbes = [],
  historicalMetrics = [],
  consecutiveFailures = 0,
}) {
  // If no raw probes were attempted or error, do NOT report zero loss
  if (!Array.isArray(rawProbes) || rawProbes.length === 0) {
    return {
      currentLossPercent: null,
      historicalLossPercent: null,
      consecutiveFailed: consecutiveFailures,
      availabilityPercent: null,
      trend: 'unknown',
    };
  }

  const validProbes = rawProbes.filter((p) => typeof p.success === 'boolean');
  if (validProbes.length === 0) {
    return {
      currentLossPercent: null,
      historicalLossPercent: null,
      consecutiveFailed: consecutiveFailures,
      availabilityPercent: null,
      trend: 'unknown',
    };
  }

  const failedCount = validProbes.filter((p) => !p.success).length;
  const currentLossPercent = Math.round((failedCount / validProbes.length) * 100 * 10) / 10;
  const currentAvailability = Math.round((100 - currentLossPercent) * 10) / 10;

  // Calculate historical loss from past metrics
  let historicalLossPercent = null;
  let historicalAvailability = null;
  const pastLosses = historicalMetrics
    .map((m) => m?.packetLoss)
    .filter((loss) => typeof loss === 'number' && Number.isFinite(loss));

  if (pastLosses.length > 0) {
    const avgLoss = pastLosses.reduce((acc, l) => acc + l, 0) / pastLosses.length;
    historicalLossPercent = Math.round(avgLoss * 10) / 10;
    historicalAvailability = Math.round((100 - historicalLossPercent) * 10) / 10;
  }

  // Trend detection
  let trend = 'stable';
  if (historicalLossPercent !== null) {
    if (currentLossPercent > historicalLossPercent + 5) {
      trend = 'degrading';
    } else if (currentLossPercent < historicalLossPercent - 5) {
      trend = 'improving';
    }
  }

  return {
    currentLossPercent,
    historicalLossPercent,
    consecutiveFailed: consecutiveFailures,
    availabilityPercent: currentAvailability,
    trend,
  };
}

module.exports = {
  calculatePercentile,
  calculateMedian,
  computeLatencyMetrics,
  computePacketLossMetrics,
};
