const { authorizeMonitoringDevice, findSubnetForIp } = require('./subnetAuthorization');

function mapDiscoveredDevices(
  discovered,
  existingDevices,
  monitoringAllowlist,
  approvedSubnets = [],
  authorizationMode = 'legacy_allowlists',
  autoAuthorizeInterfaces = false,
) {
  const devicesByIp = new Map(existingDevices.map((device) => [device.ipAddress, device]));

  return discovered.map((device) => {
    const enrolledDevice = devicesByIp.get(device.ipAddress);
    const subnet = findSubnetForIp(device.ipAddress, approvedSubnets);
    const authorization = enrolledDevice
      ? authorizeMonitoringDevice(
        enrolledDevice,
        approvedSubnets,
        monitoringAllowlist,
        { authorizationMode, autoAuthorizeInterfaces },
      )
      : {
        authorized: false,
        reason: 'Device is discovered but not enrolled',
        code: 'NOT_ENROLLED',
      };
    return {
      ...device,
      isEnrolled: Boolean(enrolledDevice),
      deviceId: enrolledDevice ? String(enrolledDevice._id) : null,
      monitoringStatus: enrolledDevice ? Boolean(enrolledDevice.monitoringStatus) : false,
      enrollmentStatus: enrolledDevice?.enrollmentStatus || 'not_enrolled',
      subnetId: subnet ? String(subnet._id) : null,
      monitoringAuthorized: authorization.authorized,
      monitoringAuthorizationCode: authorization.code,
      monitoringAuthorizationReason: authorization.reason,
    };
  });
}

module.exports = { mapDiscoveredDevices };
