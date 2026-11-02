const mongoose = require('mongoose');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const networkInterfaceService = require('../utils/networkInterfaceService');
const { ipToNumber, parseCidr } = require('../utils/ipValidation');
const { MAX_DISCOVERY_HOSTS } = require('../utils/networkSafety');
const {
  NETWORK_AUTHORIZATION_MODES,
  getNetworkAuthorizationPolicy,
} = require('../utils/networkAuthorizationPolicy');

let synchronizationRunning = false;

function subnetDetails(cidr) {
  const parsed = parseCidr(cidr);
  if (!parsed) return null;
  return {
    cidr: parsed.cidr,
    networkAddress: parsed.network,
    subnetMask: parsed.subnetMask,
    broadcastAddress: parsed.broadcast,
    firstUsableIp: parsed.firstHost,
    lastUsableIp: parsed.lastHost,
    totalAddressCount: parsed.totalAddresses,
    usableHostCount: parsed.hostCount,
  };
}

function subnetsOverlap(leftCidr, rightCidr) {
  const left = parseCidr(leftCidr);
  const right = parseCidr(rightCidr);
  if (!left || !right) return false;
  return ipToNumber(left.network) <= ipToNumber(right.broadcast)
    && ipToNumber(right.network) <= ipToNumber(left.broadcast);
}

function audit(event, actorId, details) {
  console.info(JSON.stringify({
    event,
    actorId: actorId ? String(actorId) : null,
    at: new Date().toISOString(),
    ...details,
  }));
}

async function setInterfaceDisconnected(subnet, actorId) {
  if (subnet.interfaceConnected === false) return false;
  await Subnet.updateOne(
    { _id: subnet._id, authorizationSource: 'interface_policy' },
    { $set: { interfaceConnected: false } },
  );
  audit('network.interface-authorization-disconnected', actorId, {
    subnetId: String(subnet._id),
    cidr: subnet.cidr,
    interfaceName: subnet.interfaceName,
  });
  return true;
}

async function synchronizeConnectedInterfaces({ trigger = 'scheduled' } = {}) {
  if (synchronizationRunning) return { skipped: true, reason: 'synchronization_in_progress' };
  synchronizationRunning = true;

  try {
    const policySetting = await Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' });
    const policy = getNetworkAuthorizationPolicy(policySetting?.value);
    const actorId = policy.configuredBy;
    const actorIsValid = actorId && mongoose.Types.ObjectId.isValid(String(actorId));
    const autoAuthorizationEnabled = policy.mode === NETWORK_AUTHORIZATION_MODES.APPLICATION_MANAGED
      && policy.autoAuthorizeInterfaces
      && actorIsValid;
    const [detectedInterfaces, allSubnets] = await Promise.all([
      autoAuthorizationEnabled
        ? networkInterfaceService.detectNetworkInterfaces()
        : Promise.resolve([]),
      Subnet.find({}).lean(),
    ]);
    const observed = new Map();
    const result = {
      skipped: false,
      authorized: 0,
      refreshed: 0,
      disconnected: 0,
      skippedInterfaces: 0,
      reason: null,
    };

    if (autoAuthorizationEnabled) {
      for (const networkInterface of detectedInterfaces) {
        const eligibility = networkInterfaceService.getPolicyEligibleInterface(networkInterface, policy);
        if (!eligibility.eligible) {
          if (networkInterface.status === 'up' && policy.interfaceTypes.includes(networkInterface.type)) {
            result.skippedInterfaces += 1;
          }
          continue;
        }

        observed.set(eligibility.cidr.cidr, networkInterface);
        const exactRecord = allSubnets.find((subnet) => subnet.cidr === eligibility.cidr.cidr);
        if (exactRecord) {
          if (exactRecord.authorizationSource === 'interface_policy') {
            const changed = exactRecord.interfaceConnected !== true
              || exactRecord.interfaceName !== networkInterface.name
              || exactRecord.interfaceType !== networkInterface.type;
            await Subnet.updateOne(
              { _id: exactRecord._id, authorizationSource: 'interface_policy' },
              {
                $set: {
                  interfaceName: networkInterface.name,
                  interfaceType: networkInterface.type,
                  interfaceConnected: true,
                  lastInterfaceSeenAt: new Date(),
                },
              },
            );
            if (changed) {
              result.refreshed += 1;
              audit('network.interface-authorization-reconnected', actorId, {
                subnetId: String(exactRecord._id),
                cidr: eligibility.cidr.cidr,
                interfaceName: networkInterface.name,
                interfaceType: networkInterface.type,
                trigger,
              });
            }
          } else if (exactRecord.status === 'active' && exactRecord.approvalStatus === 'pending') {
            const overlappingSubnet = allSubnets.find((subnet) => (
              String(subnet._id) !== String(exactRecord._id)
              && subnetsOverlap(subnet.cidr, eligibility.cidr.cidr)
            ));
            if (overlappingSubnet) {
              result.skippedInterfaces += 1;
              continue;
            }
            const approval = await Subnet.updateOne(
              { _id: exactRecord._id, status: 'active', approvalStatus: 'pending' },
              {
                $set: {
                  approvalStatus: 'approved',
                  approvedBy: actorId,
                  approvedAt: new Date(),
                  authorizationSource: 'interface_policy',
                  interfaceName: networkInterface.name,
                  interfaceType: networkInterface.type,
                  interfaceConnected: true,
                  lastInterfaceSeenAt: new Date(),
                },
              },
            );
            if (approval.modifiedCount === 0) {
              result.skippedInterfaces += 1;
              continue;
            }
            audit('network.interface-auto-authorized', actorId, {
              subnetId: String(exactRecord._id),
              cidr: eligibility.cidr.cidr,
              interfaceName: networkInterface.name,
              interfaceType: networkInterface.type,
              hostCount: eligibility.hostCount,
              trigger,
              approvedPendingRegistration: true,
            });
            result.authorized += 1;
          }
          continue;
        }

        const overlappingSubnet = allSubnets.find((subnet) => subnetsOverlap(subnet.cidr, eligibility.cidr.cidr));
        if (overlappingSubnet) {
          result.skippedInterfaces += 1;
          continue;
        }

        try {
          const details = subnetDetails(eligibility.cidr.cidr);
          await Subnet.create({
            ...details,
            name: `${networkInterface.name} (${eligibility.cidr.cidr})`.slice(0, 120),
            description: 'Automatically authorized from a connected interface under administrator policy',
            status: 'active',
            approvalStatus: 'approved',
            authorizationSource: 'interface_policy',
            interfaceName: networkInterface.name,
            interfaceType: networkInterface.type,
            interfaceConnected: true,
            lastInterfaceSeenAt: new Date(),
            createdBy: actorId,
            approvedBy: actorId,
            approvedAt: new Date(),
            autoEnroll: false,
            requireEnrollmentApproval: true,
            monitoringEnabled: false,
            discoveryScheduleEnabled: false,
          });
          allSubnets.push({
            cidr: eligibility.cidr.cidr,
            authorizationSource: 'interface_policy',
            interfaceConnected: true,
          });
          result.authorized += 1;
          audit('network.interface-auto-authorized', actorId, {
            cidr: eligibility.cidr.cidr,
            interfaceName: networkInterface.name,
            interfaceType: networkInterface.type,
            hostCount: eligibility.hostCount,
            trigger,
          });
        } catch (error) {
          if (error.code !== 11000) throw error;
          result.skippedInterfaces += 1;
        }
      }
    } else {
      result.reason = policy.mode !== NETWORK_AUTHORIZATION_MODES.APPLICATION_MANAGED
        ? 'application_managed_mode_disabled'
        : !actorIsValid
          ? 'administrator_configuration_missing'
          : 'automatic_interface_authorization_disabled';
    }

    const managedSubnets = allSubnets.filter((subnet) => subnet.authorizationSource === 'interface_policy');
    for (const subnet of managedSubnets) {
      if (!observed.has(subnet.cidr) && await setInterfaceDisconnected(subnet, actorId)) {
        result.disconnected += 1;
      }
    }

    return result;
  } finally {
    synchronizationRunning = false;
  }
}

function isFreshInterfaceAuthorization(subnet, now = Date.now()) {
  if (subnet?.authorizationSource !== 'interface_policy') return true;
  if (subnet.interfaceConnected !== true || !subnet.lastInterfaceSeenAt) return false;
  const age = now - new Date(subnet.lastInterfaceSeenAt).getTime();
  return age >= 0 && age <= 90_000;
}

module.exports = {
  synchronizeConnectedInterfaces,
  isFreshInterfaceAuthorization,
};
