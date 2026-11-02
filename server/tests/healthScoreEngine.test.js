const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateAvailabilityScore,
  calculatePerformanceScore,
  calculateTrafficScore,
  calculateHardwareScore,
  calculateOverallHealthScore,
} = require('../utils/healthScoreEngine');

test('calculateAvailabilityScore returns 0 for offline devices and null for unknown', () => {
  assert.equal(calculateAvailabilityScore('DOWN', 0).score, 0);
  assert.equal(calculateAvailabilityScore('UNKNOWN', null).score, null);
  assert.equal(calculateAvailabilityScore('UP', 100).score, 100);
  assert.equal(calculateAvailabilityScore('UP', 80).score, 80);
});

test('calculatePerformanceScore evaluates latency, loss, and jitter', () => {
  const healthy = calculatePerformanceScore(15, 0, 2);
  assert.ok(healthy.score >= 95);

  const degraded = calculatePerformanceScore(120, 10, 15);
  assert.ok(degraded.score < 80);

  const missing = calculatePerformanceScore(null, null, null);
  assert.equal(missing.score, null);
});

test('calculateOverallHealthScore normalizes weights and excludes unsupported metrics without penalizing as zero', () => {
  // Device with only ping measurements (no SNMP traffic/hardware)
  const result = calculateOverallHealthScore({
    deviceStatus: 'UP',
    availabilityPercent: 100,
    latency: 12,
    packetLoss: 0,
    jitter: 1,
    inBps: null,
    outBps: null,
    cpuUtilization: null,
    memoryUtilization: null,
  });

  assert.ok(result.overallScore >= 90);
  assert.equal(result.healthStatus, 'Healthy');
  assert.equal(result.components.traffic, null);
  assert.equal(result.components.hardware, null);
  assert.equal(result.breakdown.find(b => b.name === 'Hardware Health').status, 'Excluded');
});

test('calculateOverallHealthScore reports Critical when device is offline', () => {
  const result = calculateOverallHealthScore({
    deviceStatus: 'DOWN',
    availabilityPercent: 0,
    latency: null,
    packetLoss: 100,
  });

  assert.equal(result.overallScore, 0);
  assert.equal(result.healthStatus, 'Critical');
});

test('calculateOverallHealthScore reports Unknown when device state is unmonitored', () => {
  const result = calculateOverallHealthScore({
    deviceStatus: 'UNKNOWN',
  });

  assert.equal(result.overallScore, null);
  assert.equal(result.healthStatus, 'Unknown');
});
