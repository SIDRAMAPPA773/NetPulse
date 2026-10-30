const { isTargetAllowed } = require('./networkSafety');

function mapDiscoveredDevices(discovered, existingDevices, monitoringAllowlist) {
  const devicesByIp = new Map(existingDevices.map((device) => [device.ipAddress, device]));

  return discovered.map((device) => {
    const enrolledDevice = devicesByIp.get(device.ipAddress);
    const monitoringAuthorized = isTargetAllowed(device.ipAddress, monitoringAllowlist);
    return {
      ...device,
      isEnrolled: Boolean(enrolledDevice),
      deviceId: enrolledDevice ? String(enrolledDevice._id) : null,
      monitoringStatus: enrolledDevice ? Boolean(enrolledDevice.monitoringStatus) : false,
      monitoringAuthorized,
      monitoringAuthorizationReason: monitoringAuthorized
        ? null
        : 'Target is not in MONITORING_TARGET_ALLOWLIST',
    };
  });
}

module.exports = { mapDiscoveredDevices };
