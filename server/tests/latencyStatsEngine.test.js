const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePercentile,
  calculateMedian,
  computeLatencyMetrics,
  computePacketLossMetrics,
} = require('../utils/latencyStatsEngine');

test('calculatePercentile computes median, p95, and p99 correctly', () => {
  const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(calculateMedian(samples), 55);
  assert.equal(calculatePercentile(samples, 95), 95.5);
  assert.equal(calculatePercentile(samples, 99), 99.1);
});

test('computeLatencyMetrics handles empty or invalid samples without fabricating zeroes', () => {
  const result = computeLatencyMetrics([]);
  assert.equal(result.current, null);
  assert.equal(result.min, null);
  assert.equal(result.max, null);
  assert.equal(result.avg, null);
  assert.equal(result.sampleCount, 0);

  const validResult = computeLatencyMetrics([12, 14, 16, 18, 20]);
  assert.equal(validResult.min, 12);
  assert.equal(validResult.max, 20);
  assert.equal(validResult.avg, 16);
  assert.equal(validResult.median, 16);
  assert.equal(validResult.jitter, 2);
});

test('computePacketLossMetrics does not treat missing measurements as zero loss', () => {
  const emptyResult = computePacketLossMetrics({ rawProbes: [] });
  assert.equal(emptyResult.currentLossPercent, null);
  assert.equal(emptyResult.availabilityPercent, null);
  assert.equal(emptyResult.trend, 'unknown');

  const measuredResult = computePacketLossMetrics({
    rawProbes: [
      { success: true, rttMs: 10 },
      { success: true, rttMs: 12 },
      { success: false },
      { success: true, rttMs: 11 },
    ],
    historicalMetrics: [{ packetLoss: 0 }],
  });
  assert.equal(measuredResult.currentLossPercent, 25);
  assert.equal(measuredResult.availabilityPercent, 75);
  assert.equal(measuredResult.trend, 'degrading');
});
