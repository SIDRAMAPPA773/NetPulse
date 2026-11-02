const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateCounterDelta,
  calculateBandwidthBps,
  calculatePacketRatePps,
  calculateInterfaceUtilization,
  computeInterfaceTrafficMetrics,
} = require('../utils/trafficAnalytics');

test('calculateCounterDelta calculates standard monotonic delta', () => {
  const result = calculateCounterDelta(1000000, 1500000, 10);
  assert.equal(result.delta, 500000);
  assert.equal(result.rolledOver, false);
  assert.equal(result.reset, false);
  assert.equal(result.reason, null);
});

test('calculateCounterDelta accurately detects and calculates 32-bit counter rollover', () => {
  const prev32 = 4294960000; // near 2^32 (4294967296)
  const curr32 = 5000;       // rolled over
  const result = calculateCounterDelta(prev32, curr32, 10, 32);

  assert.equal(result.rolledOver, true);
  assert.equal(result.reset, false);
  // Expected delta: (4294967296 - 4294960000) + 5000 = 7296 + 5000 = 12296
  assert.equal(result.delta, 12296);
});

test('calculateCounterDelta accurately detects and calculates 64-bit counter rollover', () => {
  const prev64 = '18446744073709550000'; // near 2^64 (18446744073709551616)
  const curr64 = '10000';
  const result = calculateCounterDelta(prev64, curr64, 10, 64);

  assert.equal(result.rolledOver, true);
  assert.equal(result.reset, false);
  // Expected delta: (18446744073709551616 - 18446744073709550000) + 10000 = 1616 + 10000 = 11616
  assert.equal(result.delta, 11616);
});

test('calculateCounterDelta detects counter reset or interface restart', () => {
  // Sudden drop from 1,000,000 to 500 without being near 32/64-bit threshold
  const result = calculateCounterDelta(1000000, 500, 10, 32);
  assert.equal(result.delta, null);
  assert.equal(result.reset, true);

  // Forced reboot via sysUpTime flag
  const rebootResult = calculateCounterDelta(100, 200, 10, 64, true);
  assert.equal(rebootResult.delta, null);
  assert.equal(rebootResult.reset, true);
});

test('calculateCounterDelta rejects stale or invalid intervals', () => {
  const stale = calculateCounterDelta(100, 200, 1000); // > 900s
  assert.equal(stale.delta, null);
  assert.ok(stale.reason.includes('stale'));

  const negative = calculateCounterDelta(100, 200, -5);
  assert.equal(negative.delta, null);
});

test('computeInterfaceTrafficMetrics calculates bandwidth, PPS, utilization, and error rates', () => {
  const prev = {
    inOctetsHC: '10000000',
    outOctetsHC: '20000000',
    inPacketsHC: '10000',
    outPacketsHC: '20000',
    inErrors: 5,
    outErrors: 2,
    inDiscards: 1,
    outDiscards: 0,
  };
  const curr = {
    inOctetsHC: '11250000', // +1,250,000 octets (10 Mbps in 1s)
    outOctetsHC: '22500000', // +2,500,000 octets (20 Mbps in 1s)
    inPacketsHC: '12000',    // +2,000 packets (2000 pps)
    outPacketsHC: '24000',   // +4,000 packets (4000 pps)
    inErrors: 15,            // +10 errors (10 err/s)
    outErrors: 2,            // 0 err
    inDiscards: 3,           // +2 discards (2 disc/s)
    outDiscards: 0,
  };

  const elapsed = 1.0;
  const gigabitSpeed = 1000000000; // 1 Gbps

  const metrics = computeInterfaceTrafficMetrics(prev, curr, elapsed, {
    interfaceSpeedBps: gigabitSpeed,
    is64Bit: true,
  });

  assert.equal(metrics.inOctetsDelta, 1250000);
  assert.equal(metrics.outOctetsDelta, 2500000);
  assert.equal(metrics.inBps, 10000000); // 10 Mbps
  assert.equal(metrics.outBps, 20000000); // 20 Mbps
  assert.equal(metrics.inPps, 2000);
  assert.equal(metrics.outPps, 4000);
  assert.equal(metrics.inErrorRate, 10);
  assert.equal(metrics.outErrorRate, 0);
  assert.equal(metrics.inDiscardRate, 2);
  assert.equal(metrics.inUtilization, 1.0); // 10 Mbps / 1 Gbps = 1%
  assert.equal(metrics.outUtilization, 2.0); // 20 Mbps / 1 Gbps = 2%
  assert.equal(metrics.overallUtilization, 2.0);
});
