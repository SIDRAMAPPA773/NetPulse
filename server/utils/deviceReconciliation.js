const { normalizeMac } = require('./neighbourService');

function normalizeSysName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function isDeviceInApprovedSubnet(device, approvedHosts, subnetId) {
  return (device?.subnet && String(device.subnet) === String(subnetId))
    || approvedHosts.has(device?.ipAddress);
}

function findIdentityMatch(candidate, devices, approvedHosts, subnetId) {
  const candidateMac = normalizeMac(candidate?.macAddress);
  const candidateSysName = normalizeSysName(candidate?.snmpSysName);
  const eligibleDevices = devices.filter((device) => (
    isDeviceInApprovedSubnet(device, approvedHosts, subnetId)
  ));

  return eligibleDevices.find((device) => device.ipAddress === candidate.ipAddress)
    || (candidateMac && eligibleDevices.find((device) => normalizeMac(device.macAddress) === candidateMac))
    || (candidateSysName && eligibleDevices.find((device) => (
      normalizeSysName(device.snmpSysName) === candidateSysName
    )))
    || null;
}

async function reconcileDeviceIdentity(device, candidate, {
  subnetId,
  reason = 'approved-subnet-discovery',
  now = new Date(),
} = {}) {
  if (!device || !candidate?.ipAddress) return { changed: false, device };

  const previousIpAddress = device.ipAddress;
  const nextMacAddress = normalizeMac(candidate.macAddress);
  const nextSysName = normalizeSysName(candidate.snmpSysName);
  const ipChanged = previousIpAddress !== candidate.ipAddress;

  if (ipChanged) {
    device.ipAddressChanges = [
      ...(Array.isArray(device.ipAddressChanges) ? device.ipAddressChanges : []),
      {
        previousIpAddress,
        newIpAddress: candidate.ipAddress,
        reason,
        observedAt: now,
      },
    ].slice(-100);
    device.ipAddress = candidate.ipAddress;
    console.info(JSON.stringify({
      event: 'device.ip-reconciled',
      deviceId: String(device._id),
      previousIpAddress,
      newIpAddress: candidate.ipAddress,
      reason,
      at: now.toISOString(),
    }));
  }

  if (!device.macAddress && nextMacAddress) device.macAddress = nextMacAddress;
  if (nextSysName) device.snmpSysName = candidate.snmpSysName.trim();
  if (!device.subnet && subnetId) device.subnet = subnetId;
  device.lastSeen = now;
  device.lastVerifiedAt = now;
  device.lastDiscoveredAt = now;
  await device.save();

  return { changed: ipChanged, device };
}

module.exports = {
  normalizeSysName,
  findIdentityMatch,
  reconcileDeviceIdentity,
};
