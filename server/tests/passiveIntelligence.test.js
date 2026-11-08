const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { parseWindowsNetstatRoutes, parseLinuxIpRoute } = require('../utils/routeService');
const { collectPassiveIntelligence, syncPassiveInventory } = require('../services/passiveIntelligenceService');
const Device = require('../models/Device');
const Alert = require('../models/Alert');

test('parseWindowsNetstatRoutes extracts default gateway and subnets', () => {
  const sample = `
IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0     10.238.79.51    10.238.79.191     35
      10.238.79.0    255.255.255.0         On-link     10.238.79.191    291
    10.238.79.191  255.255.255.255         On-link     10.238.79.191    291
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
===========================================================================
IPv6 Route Table
===========================================================================
Active Routes:
 If Metric Network Destination      Gateway
 18     51 ::/0                     fe80::ec66:28ff:fe63:37ac
  1    331 ::1/128                  On-link
===========================================================================
  `;

  const parsed = parseWindowsNetstatRoutes(sample);
  assert.equal(parsed.gateways.length, 2);
  assert.equal(parsed.gateways[0].gatewayIp, '10.238.79.51');
  assert.equal(parsed.gateways[0].isDefault, true);
  assert.equal(parsed.gateways[0].protocol, 'IPv4');
  assert.equal(parsed.gateways[1].gatewayIp, 'fe80::ec66:28ff:fe63:37ac');
  assert.equal(parsed.gateways[1].protocol, 'IPv6');
});

test('parseLinuxIpRoute extracts default gateway and route destinations', () => {
  const sample = `
default via 192.168.1.1 dev eth0 proto dhcp metric 100
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.50
  `;

  const parsed = parseLinuxIpRoute(sample);
  assert.equal(parsed.gateways.length, 1);
  assert.equal(parsed.gateways[0].gatewayIp, '192.168.1.1');
  assert.equal(parsed.gateways[0].isDefault, true);
  assert.equal(parsed.routes.length, 2);
});

test('collectPassiveIntelligence does not mark observed devices online and honors passive mode rules', async () => {
  const fakeNeighbourMap = new Map([
    ['192.168.1.50', {
      ipAddress: '192.168.1.50',
      macAddress: '00:11:22:33:44:55',
      networkInterface: '192.168.1.10',
      state: 'Reachable',
    }],
    ['192.168.1.60', {
      ipAddress: '192.168.1.60',
      macAddress: '00:00:0C:11:22:33',
      networkInterface: '192.168.1.10',
      state: 'Stale',
    }],
  ]);

  const fakeRoutes = {
    gateways: [{ gatewayIp: '192.168.1.1', interfaceIp: '192.168.1.10', isDefault: true, protocol: 'IPv4' }],
    routes: [],
  };

  const result = await collectPassiveIntelligence({
    neighbourTableOverride: fakeNeighbourMap,
    routesOverride: fakeRoutes,
    interfacesOverride: [{ name: 'eth0', ipAddress: '192.168.1.10', subnetMask: '255.255.255.0' }],
    resolveDns: false,
  });

  assert.equal(result.observedDevices.length, 3); // 2 neighbours + 1 gateway
  for (const device of result.observedDevices) {
    // Mode A: NEVER claim an observed device is online merely because it exists in cache
    assert.equal(device.status, 'UNKNOWN');
    assert.equal(device.isPassiveOnly, true);
    assert.equal(device.monitoringTier, 'observed');
  }

  const ciscoDevice = result.observedDevices.find((d) => d.ipAddress === '192.168.1.60');
  assert.equal(ciscoDevice.vendor, 'Cisco Systems');
});

test('syncPassiveInventory detects IP-to-MAC mapping changes and raises alerts', async () => {
  const originalFindOne = Device.findOne;
  const originalCreate = Device.create;
  const originalAlertCreate = Alert.create;

  const savedAlerts = [];
  let existingDevice = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Lab Server',
    ipAddress: '192.168.1.80',
    macAddress: '00:11:22:AA:BB:CC',
    hostname: 'lab-srv.local',
    observedMacChanges: [],
    observedHostnameChanges: [],
    save: async function () { return this; },
  };

  Device.findOne = async ({ ipAddress }) => {
    if (ipAddress === '192.168.1.80') return existingDevice;
    return null;
  };
  Alert.create = async (alertData) => {
    savedAlerts.push(alertData);
    return alertData;
  };

  const fakeNeighbourMap = new Map([
    ['192.168.1.80', {
      ipAddress: '192.168.1.80',
      macAddress: 'AA:BB:CC:DD:EE:FF', // MAC changed!
      state: 'Reachable',
    }],
  ]);

  try {
    const syncRes = await syncPassiveInventory({
      neighbourTableOverride: fakeNeighbourMap,
      routesOverride: { gateways: [], routes: [] },
      interfacesOverride: [],
      resolveDns: false,
    });

    assert.equal(syncRes.changes.length, 1);
    assert.equal(syncRes.changes[0].type, 'MAC_CHANGED');
    assert.equal(syncRes.changes[0].previous, '00:11:22:AA:BB:CC');
    assert.equal(syncRes.changes[0].current, 'AA:BB:CC:DD:EE:FF');
    assert.equal(savedAlerts.length, 1);
    assert.equal(savedAlerts[0].type, 'IP_MAC_MAPPING_CHANGED');
  } finally {
    Device.findOne = originalFindOne;
    Device.create = originalCreate;
    Alert.create = originalAlertCreate;
  }
});
