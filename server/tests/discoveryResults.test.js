const test = require('node:test');
const assert = require('node:assert/strict');
const { mapDiscoveredDevices } = require('../utils/discoveryResults');

test('discovery maps enrolled responders to stable device IDs and monitoring authorization', () => {
  const discovered = [
    { ipAddress: '10.38.27.142', name: 'Responder A' },
    { ipAddress: '10.38.27.191', name: 'Responder B' },
    { ipAddress: '10.38.27.200', name: 'Responder C' },
  ];
  const existing = [
    { _id: 'device-a', ipAddress: '10.38.27.142', monitoringStatus: true },
    { _id: 'device-b', ipAddress: '10.38.27.191', monitoringStatus: false },
  ];

  const subnets = [{
    _id: 'subnet-id',
    cidr: '10.38.27.0/24',
    status: 'active',
    approvalStatus: 'approved',
    monitoringEnabled: true,
  }];
  const results = mapDiscoveredDevices(discovered, existing, ['10.38.27.0/24'], subnets);

  assert.deepEqual(results.map(({ isEnrolled, deviceId }) => [isEnrolled, deviceId]), [
    [true, 'device-a'],
    [true, 'device-b'],
    [false, null],
  ]);
  assert.equal(results[0].monitoringAuthorized, true);
  assert.equal(results[1].monitoringStatus, false);
  assert.equal(results[2].monitoringAuthorized, false);
  assert.equal(results[2].monitoringAuthorizationCode, 'NOT_ENROLLED');
});

test('discovery approval does not grant continuous monitoring authorization', () => {
  const [result] = mapDiscoveredDevices(
    [{ ipAddress: '10.38.27.142' }],
    [{ _id: 'device-a', ipAddress: '10.38.27.142', monitoringStatus: true }],
    [],
    [{
      cidr: '10.38.27.0/24',
      status: 'active',
      approvalStatus: 'approved',
      monitoringEnabled: true,
    }],
  );

  assert.equal(result.isEnrolled, true);
  assert.equal(result.monitoringAuthorized, false);
  assert.equal(result.monitoringAuthorizationCode, 'MIGRATION_ALLOWLIST_BLOCKED');
});
