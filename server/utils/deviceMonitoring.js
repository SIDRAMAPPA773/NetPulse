const { isTargetAllowed } = require('./networkSafety');

function createDeviceMonitoringSummary(device, latestMetric, monitoringAllowlist, latestSuccessfulMeasurement = null) {
  const monitoringAuthorized = isTargetAllowed(device.ipAddress, monitoringAllowlist);

  return {
    ...device,
    monitoringAuthorized,
    monitoringAuthorizationReason: monitoringAuthorized
      ? null
      : 'Target is not in MONITORING_TARGET_ALLOWLIST',
    collectionStatus: latestMetric?.collectionStatus || 'no_measurements',
    collectionReason: latestMetric?.reasonUnavailable
      || (latestMetric ? null : 'No measurements recorded in the last 7 days'),
    latestMetric: latestMetric || null,
    latestSuccessfulMeasurement,
  };
}

module.exports = { createDeviceMonitoringSummary };
