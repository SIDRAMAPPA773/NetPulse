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
  assert.equal(calculateAvailabilityScore('DOWN', null).score, null);
  assert.equal(calculateAvailabilityScore('UNKNOWN', null).score, null);
  assert.equal(calculateAvailabilityScore('UNKNOWN', 0).score, 0);
  assert.equal(calculateAvailabilityScore('UP', 100).score, 100);
  assert.equal(calculateAvailabilityScore('UP', 80).score, 80);
  assert.equal(calculateAvailabilityScore('UP', null).score, null);
});

test('calculatePerformanceScore evaluates latency, loss, and jitter', () => {
  const healthy = calculatePerformanceScore(15, 0, 2);
  assert.ok(healthy.score >= 95);

  const degraded = calculatePerformanceScore(120, 10, 15);
  assert.ok(degraded.score < 80);

  const missing = calculatePerformanceScore(null, null, null);
  assert.equal(missing.score, null);

  const latencyOnly = calculatePerformanceScore(10, null, null);
  assert.equal(latencyOnly.score, 100);
  assert.equal(latencyOnly.coveragePercent, 55);
});

test('calculateOverallHealthScore limits its maximum to measured-component evidence coverage', () => {
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

  assert.equal(result.overallScore, 70);
  assert.equal(result.coveragePercent, 70);
  assert.equal(result.healthStatus, 'Warning');
  assert.equal(result.components.traffic, null);
  assert.equal(result.components.hardware, null);
  assert.equal(result.breakdown.find(b => b.name === 'Hardware Health').status, 'Excluded');
});

test('inventory UP status without a probe sample does not create a healthy availability score', () => {
  const result = calculateOverallHealthScore({
    deviceStatus: 'UP',
  });

  assert.equal(result.overallScore, null);
  assert.equal(result.healthStatus, 'Unknown');
  assert.equal(result.components.availability, null);
  assert.match(result.explanation, /No measurable metrics|unknown/i);
});

test('one measured component leaves overall health unknown below minimum evidence coverage', () => {
  const result = calculateOverallHealthScore({
    deviceStatus: 'UP',
    availabilityPercent: 100,
  });

  assert.equal(result.coveragePercent, 35);
  assert.equal(result.overallScore, null);
  assert.equal(result.healthStatus, 'Unknown');
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
  assert.equal(result.components.performance, 0);
});

test('calculateOverallHealthScore reports Unknown when device state is unmonitored', () => {
  const result = calculateOverallHealthScore({
    deviceStatus: 'UNKNOWN',
  });

  assert.equal(result.overallScore, null);
  assert.equal(result.healthStatus, 'Unknown');
});
