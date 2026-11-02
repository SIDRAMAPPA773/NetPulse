const { isValidIPv4, parseCidr, ipToNumber } = require('./ipValidation');
const { isTargetAllowed } = require('./networkSafety');
const { isFreshInterfaceAuthorization } = require('../services/interfaceAuthorizationService');

function findSubnetForIp(ipAddress, subnets = []) {
  if (!isValidIPv4(ipAddress)) return null;
  const ipValue = ipToNumber(ipAddress);

  const matches = subnets
    .map((subnet) => ({ subnet, range: parseCidr(subnet.cidr) }))
    .filter(({ subnet, range }) => (
      subnet.status === 'active'
      && subnet.approvalStatus === 'approved'
      && isFreshInterfaceAuthorization(subnet)
      && range
      && ipValue >= ipToNumber(range.network)
      && ipValue <= ipToNumber(range.broadcast)
    ))
    .sort((left, right) => right.range.mask - left.range.mask);

  return matches[0]?.subnet || null;
}

function authorizeMonitoringDevice(
  device,
  subnets,
  monitoringAllowlist,
  {
    authorizationMode = 'legacy_allowlists',
    autoAuthorizeInterfaces = false,
  } = {},
) {
  if (device.enrollmentStatus === 'pending') {
    return { authorized: false, code: 'ENROLLMENT_PENDING', reason: 'Device enrollment is awaiting administrator approval' };
  }
  if (device.monitoringStatus === false) {
    return { authorized: false, code: 'MONITORING_DISABLED', reason: 'Monitoring is not enabled for this device' };
  }
  const subnet = findSubnetForIp(device.ipAddress, subnets);
  if (!subnet) {
    const disconnectedInterfaceSubnet = subnets.find((entry) => (
      entry.authorizationSource === 'interface_policy'
      && entry.status === 'active'
      && entry.approvalStatus === 'approved'
      && parseCidr(entry.cidr)
      && ipToNumber(device.ipAddress) >= ipToNumber(parseCidr(entry.cidr).network)
      && ipToNumber(device.ipAddress) <= ipToNumber(parseCidr(entry.cidr).broadcast)
      && !isFreshInterfaceAuthorization(entry)
    ));
    return disconnectedInterfaceSubnet
      ? {
        authorized: false,
        code: 'INTERFACE_NOT_CONNECTED',
        reason: 'The administrator-authorized interface is no longer confirmed connected',
      }
      : { authorized: false, code: 'SUBNET_NOT_APPROVED', reason: 'Device is outside all active, approved subnets' };
  }
  if (subnet.authorizationSource === 'interface_policy' && !autoAuthorizeInterfaces) {
    return {
      authorized: false,
      code: 'INTERFACE_POLICY_DISABLED',
      reason: 'Automatic authorization for connected interfaces is disabled by administrator policy',
      subnet,
    };
  }
  if (subnet.monitoringEnabled !== true) {
    return { authorized: false, code: 'SUBNET_MONITORING_DISABLED', reason: 'Monitoring is disabled for this subnet' };
  }
  if (authorizationMode !== 'application_managed' && !isTargetAllowed(device.ipAddress, monitoringAllowlist)) {
    return {
      authorized: false,
      code: 'MIGRATION_ALLOWLIST_BLOCKED',
      reason: 'Device is outside MONITORING_TARGET_ALLOWLIST; add its approved subnet CIDR during migration',
      subnet,
    };
  }
  return { authorized: true, code: null, reason: null, subnet };
}

module.exports = { findSubnetForIp, authorizeMonitoringDevice };
