const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceMonitoringSummary } = require('../utils/deviceMonitoring');

test('inventory reports unavailable collection and authorization for a device without metrics', () => {
  const summary = createDeviceMonitoringSummary(
    { _id: 'device-id', ipAddress: '10.38.27.142', monitoringStatus: true },
    null,
    [],
  );

  assert.equal(summary._id, 'device-id');
  assert.equal(summary.collectionStatus, 'no_measurements');
  assert.equal(summary.collectionReason, 'No measurements recorded in the last 7 days');
  assert.equal(summary.monitoringAuthorized, false);
});

test('inventory preserves the latest real authorization-blocked collection reason', () => {
  const summary = createDeviceMonitoringSummary(
    { _id: 'device-id', ipAddress: '10.38.27.142', monitoringStatus: true },
    {
      collectionStatus: 'blocked',
      reasonUnavailable: 'Target is not in MONITORING_TARGET_ALLOWLIST',
      measurementSource: 'real',
    },
    [],
  );

  assert.equal(summary.collectionStatus, 'blocked');
  assert.equal(summary.collectionReason, 'Target is not in MONITORING_TARGET_ALLOWLIST');
  assert.equal(summary.latestMetric.measurementSource, 'real');
});
