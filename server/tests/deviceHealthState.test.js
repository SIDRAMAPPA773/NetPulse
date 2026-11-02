const test = require('node:test');
const assert = require('node:assert/strict');
const { transitionDeviceHealth } = require('../utils/deviceHealthState');

test('a device transitions down only after consecutive failed observations', () => {
  const device = { status: 'UP', consecutiveFailureCount: 0 };
  const observation = { reachable: false };

  assert.equal(transitionDeviceHealth(device, observation), 'UP');
  assert.equal(transitionDeviceHealth(device, observation), 'UP');
  assert.equal(transitionDeviceHealth(device, observation), 'DOWN');
  assert.equal(device.consecutiveFailureCount, 3);
});

test('a down device recovers only after consecutive successful observations', () => {
  const device = { status: 'DOWN', consecutiveFailureCount: 3, consecutiveRecoveryCount: 0 };

  assert.equal(transitionDeviceHealth(device, { reachable: true }), 'DOWN');
  assert.equal(transitionDeviceHealth(device, { reachable: true, degraded: true }), 'WARNING');
  assert.equal(device.consecutiveFailureCount, 0);
  assert.equal(device.consecutiveRecoveryCount, 0);
});

test('collection errors do not count as a failed network observation', () => {
  const device = { status: 'UP', consecutiveFailureCount: 2, consecutiveRecoveryCount: 0 };

  assert.equal(transitionDeviceHealth(device, { reachable: false, collectionError: true }), 'UP');
  assert.equal(device.consecutiveFailureCount, 0);
});

test('a previously unknown device stays unknown during initial failed probes', () => {
  const device = { status: 'UNKNOWN' };

  assert.equal(transitionDeviceHealth(device, { reachable: false }), 'UNKNOWN');
  assert.equal(transitionDeviceHealth(device, { reachable: false }), 'UNKNOWN');
  assert.equal(transitionDeviceHealth(device, { reachable: false }), 'DOWN');
});
