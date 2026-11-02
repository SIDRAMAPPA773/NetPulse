const { authorizeMonitoringDevice, findSubnetForIp } = require('./subnetAuthorization');

function createDeviceMonitoringSummary(
  device,
  latestMetric,
  monitoringAllowlist,
  latestSuccessfulMeasurement = null,
  approvedSubnets = [],
  authorizationMode = 'legacy_allowlists',
  autoAuthorizeInterfaces = false,
) {
  const authorization = authorizeMonitoringDevice(
    device,
    approvedSubnets,
    monitoringAllowlist,
    { authorizationMode, autoAuthorizeInterfaces },
  );
  const subnet = findSubnetForIp(device.ipAddress, approvedSubnets);

  return {
    ...device,
    subnet: subnet
      ? { _id: subnet._id, name: subnet.name, cidr: subnet.cidr }
      : (device.subnet?.name ? device.subnet : null),
    monitoringAuthorized: authorization.authorized,
    monitoringAuthorizationCode: authorization.code,
    monitoringAuthorizationReason: authorization.reason,
    collectionStatus: latestMetric?.collectionStatus || 'no_measurements',
    collectionReason: latestMetric?.reasonUnavailable
      || (latestMetric ? null : 'No measurements recorded in the last 7 days'),
    latestMetric: latestMetric || null,
    latestSuccessfulMeasurement,
  };
}

module.exports = { createDeviceMonitoringSummary };
