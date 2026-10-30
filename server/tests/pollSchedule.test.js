const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeviceDueForPolling } = require('../utils/pollSchedule');
const { isTargetAllowed } = require('../utils/networkSafety');

test('enabled and authorized devices become due at their configured interval', () => {
  const device = {
    ipAddress: '10.38.27.142',
    monitoringStatus: true,
    pollingInterval: 30,
  };
  const now = 100_000;

  assert.equal(isTargetAllowed(device.ipAddress, ['10.38.27.0/24']), true);
  assert.equal(isDeviceDueForPolling(device, now, 69_999), true);
  assert.equal(isDeviceDueForPolling(device, now, 70_000), true);
  assert.equal(isDeviceDueForPolling(device, now, 70_001), false);
  assert.equal(isDeviceDueForPolling({ ...device, monitoringStatus: false }, now, 0), false);
});

test('polling enforces the minimum interval even when a smaller value is stored', () => {
  assert.equal(isDeviceDueForPolling(
    { monitoringStatus: true, pollingInterval: 1 },
    10_000,
    0,
  ), true);
  assert.equal(isDeviceDueForPolling(
    { monitoringStatus: true, pollingInterval: 1 },
    9_999,
    0,
  ), false);
});
