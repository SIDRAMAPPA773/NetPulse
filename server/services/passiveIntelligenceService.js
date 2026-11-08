const Device = require('../models/Device');
const Alert = require('../models/Alert');
const { getNeighbourTable } = require('../utils/neighbourService');
const { getLocalRoutes } = require('../utils/routeService');
const networkInterfaceService = require('../utils/networkInterfaceService');
const { resolveHostname } = require('../utils/dnsProbe');
const { identifyDevice } = require('../utils/deviceIdentification');
const { getIO } = require('./socketService');

let lastPassiveSyncAt = null;
let passiveSyncInProgress = false;

async function collectPassiveIntelligence(options = {}) {
  const {
    neighbourTableOverride = null,
    routesOverride = null,
    interfacesOverride = null,
    resolveDns = true,
  } = options;

  const now = new Date();

  // 1. Fetch locally available neighbour cache, routing table, and interface info
  const [neighbourTable, routeInfo, interfaces] = await Promise.all([
    neighbourTableOverride !== null ? Promise.resolve(neighbourTableOverride) : getNeighbourTable(),
    routesOverride !== null ? Promise.resolve(routesOverride) : getLocalRoutes(),
    interfacesOverride !== null ? Promise.resolve(interfacesOverride) : networkInterfaceService.getAvailableNetworkInterfaces(),
  ]);

  const observedDevices = [];
  const changesDetected = [];
  const localGatewayIps = new Set(routeInfo.gateways.map((g) => g.gatewayIp));

  // Map known local subnets and gateways
  const interfaceSubnetMap = new Map();
  for (const iface of interfaces) {
    if (iface.ipAddress) {
      interfaceSubnetMap.set(iface.ipAddress, iface);
    }
  }

  // 2. Process neighbour cache entries (ARP / ND)
  for (const [ipAddress, entry] of neighbourTable.entries()) {
    // Skip loopback, multicast, broadcast
    if (
      !ipAddress ||
      ipAddress === '127.0.0.1' ||
      ipAddress === '::1' ||
      ipAddress.startsWith('224.') ||
      ipAddress.startsWith('239.') ||
      ipAddress.endsWith('.255') ||
      ipAddress.startsWith('ff0')
    ) {
      continue;
    }

    const mac = entry.macAddress || null;
    const isGateway = localGatewayIps.has(ipAddress);
    const associatedGateway = isGateway ? ipAddress : (routeInfo.gateways[0]?.gatewayIp || null);

    // Optional reverse DNS lookup without active network probing
    let hostname = null;
    let reverseDnsResult = null;
    if (resolveDns) {
      try {
        reverseDnsResult = await resolveHostname(ipAddress, { timeoutMs: 1500 });
        if (reverseDnsResult && reverseDnsResult.status === 'RESOLVED') {
          hostname = reverseDnsResult.hostname;
        }
      } catch {
        // DNS failure in passive mode is silent
      }
    }

    const identification = identifyDevice({
      ipAddress,
      macAddress: mac,
      hostname,
      isGateway,
      discoverySource: 'passive-neighbour-cache',
    });

    observedDevices.push({
      ipAddress,
      macAddress: mac,
      hostname,
      reverseDns: hostname,
      vendor: identification.vendor,
      deviceType: identification.deviceType,
      operatingSystem: identification.operatingSystem,
      gateway: associatedGateway,
      discoverySource: 'neighbour-cache',
      firstObservedAt: now,
      lastObservedAt: now,
      cacheState: entry.state || 'Observed',
      networkInterface: entry.networkInterface || null,
      confidenceLevel: mac ? 'Medium' : 'Observed',
      monitoringTier: 'observed',
      isPassiveOnly: true,
      status: 'UNKNOWN', // NEVER mark UP from cache alone!
    });
  }

  // 3. Process local gateways from routing table if not already observed
  for (const gateway of routeInfo.gateways) {
    if (gateway.gatewayIp && !observedDevices.some((d) => d.ipAddress === gateway.gatewayIp)) {
      let hostname = null;
      if (resolveDns) {
        try {
          const dnsRes = await resolveHostname(gateway.gatewayIp, { timeoutMs: 1500 });
          if (dnsRes && dnsRes.status === 'RESOLVED') hostname = dnsRes.hostname;
        } catch {}
      }

      const identification = identifyDevice({
        ipAddress: gateway.gatewayIp,
        isGateway: true,
        discoverySource: 'passive-route-table',
      });

      observedDevices.push({
        ipAddress: gateway.gatewayIp,
        macAddress: null,
        hostname,
        reverseDns: hostname,
        vendor: identification.vendor,
        deviceType: 'gateway',
        operatingSystem: identification.operatingSystem,
        gateway: gateway.gatewayIp,
        discoverySource: 'route-table',
        firstObservedAt: now,
        lastObservedAt: now,
        confidenceLevel: 'High',
        monitoringTier: 'observed',
        isPassiveOnly: true,
        status: 'UNKNOWN',
      });
    }
  }

  return {
    observedAt: now,
    observedDevices,
    gateways: routeInfo.gateways,
    routes: routeInfo.routes,
    interfaces,
  };
}

async function syncPassiveInventory(options = {}) {
  if (passiveSyncInProgress) {
    return { synced: 0, changes: [] };
  }
  passiveSyncInProgress = true;
  try {
    const snapshot = await collectPassiveIntelligence(options);
    const changes = [];
    let syncedCount = 0;

    for (const obs of snapshot.observedDevices) {
      let device = await Device.findOne({ ipAddress: obs.ipAddress });

      if (device) {
        let changed = false;

        // Check for MAC address change (critical passive anomaly detection)
        if (obs.macAddress && device.macAddress && device.macAddress !== obs.macAddress) {
          const changeRecord = {
            previousMac: device.macAddress,
            newMac: obs.macAddress,
            observedAt: snapshot.observedAt,
          };
          device.observedMacChanges = device.observedMacChanges || [];
          device.observedMacChanges.push(changeRecord);
          changes.push({
            type: 'MAC_CHANGED',
            ipAddress: obs.ipAddress,
            previous: device.macAddress,
            current: obs.macAddress,
          });

          // Create alert for MAC address change
          try {
            await Alert.create({
              device: device._id,
              type: 'IP_MAC_MAPPING_CHANGED',
              severity: 'HIGH',
              ipAddress: obs.ipAddress,
              message: `IP-to-MAC mapping changed for ${obs.ipAddress} from ${device.macAddress} to ${obs.macAddress}`,
              evidence: changeRecord,
              rootCauseHint: 'ARP spoofing, device replacement, or dynamic DHCP reassignment',
              firstOccurredAt: snapshot.observedAt,
              lastOccurredAt: snapshot.observedAt,
            });
          } catch {}

          device.macAddress = obs.macAddress;
          changed = true;
        } else if (obs.macAddress && !device.macAddress) {
          device.macAddress = obs.macAddress;
          changed = true;
        }

        // Check for hostname change
        if (obs.hostname && device.hostname && device.hostname !== obs.hostname) {
          const hostChangeRecord = {
            previousHostname: device.hostname,
            newHostname: obs.hostname,
            observedAt: snapshot.observedAt,
          };
          device.observedHostnameChanges = device.observedHostnameChanges || [];
          device.observedHostnameChanges.push(hostChangeRecord);
          changes.push({
            type: 'HOSTNAME_CHANGED',
            ipAddress: obs.ipAddress,
            previous: device.hostname,
            current: obs.hostname,
          });
          device.hostname = obs.hostname;
          changed = true;
        } else if (obs.hostname && !device.hostname) {
          device.hostname = obs.hostname;
          changed = true;
        }

        // Update timestamps and passive attributes
        device.lastObservedAt = snapshot.observedAt;
        if (!device.firstObservedAt) device.firstObservedAt = snapshot.observedAt;
        if (obs.gateway && !device.gateway) {
          device.gateway = obs.gateway;
          changed = true;
        }
        if (obs.reverseDns && !device.reverseDns) {
          device.reverseDns = obs.reverseDns;
          changed = true;
        }
        if (obs.vendor && obs.vendor !== 'Unknown' && (!device.vendor || device.vendor === 'Unknown')) {
          device.vendor = obs.vendor;
          changed = true;
        }

        await device.save();
        syncedCount++;
      } else {
        // Create new observed device in inventory (Mode A: Passive)
        device = await Device.create({
          name: obs.hostname || `Host-${obs.ipAddress}`,
          ipAddress: obs.ipAddress,
          macAddress: obs.macAddress,
          hostname: obs.hostname,
          reverseDns: obs.reverseDns,
          vendor: obs.vendor,
          type: obs.deviceType,
          operatingSystem: obs.operatingSystem,
          gateway: obs.gateway,
          discoverySource: obs.discoverySource,
          firstObservedAt: obs.firstObservedAt,
          lastObservedAt: obs.lastObservedAt,
          confidenceLevel: obs.confidenceLevel,
          monitoringTier: 'observed',
          isPassiveOnly: true,
          status: 'UNKNOWN',
          monitoringStatus: false, // passive devices are not auto-monitored!
          enrollmentStatus: 'pending',
          enrollmentSource: 'discovery',
        });
        syncedCount++;
      }
    }

    lastPassiveSyncAt = snapshot.observedAt;

    try {
      const io = getIO();
      if (io) {
        io.emit('passive:update', {
          observedAt: snapshot.observedAt,
          observedCount: snapshot.observedDevices.length,
          changesCount: changes.length,
        });
      }
    } catch {}

    return {
      synced: syncedCount,
      totalObserved: snapshot.observedDevices.length,
      changes,
      observedAt: snapshot.observedAt,
    };
  } finally {
    passiveSyncInProgress = false;
  }
}

function getLastPassiveSyncAt() {
  return lastPassiveSyncAt;
}

module.exports = {
  collectPassiveIntelligence,
  syncPassiveInventory,
  getLastPassiveSyncAt,
};
