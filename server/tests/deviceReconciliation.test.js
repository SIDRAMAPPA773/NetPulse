const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findIdentityMatch,
  reconcileDeviceIdentity,
} = require('../utils/deviceReconciliation');
const { selectActivePhysicalInterface } = require('../services/discoveryService');

test('hotspot discovery selects the active physical Wi-Fi interface for SNMP metrics', () => {
  const selected = selectActivePhysicalInterface([
    { interfaceIndex: 1, name: 'loopback_0', operationalStatus: 1, adminStatus: 1, speedBps: 1_073_000_000 },
    { interfaceIndex: 18, name: 'wireless_32768', description: 'MediaTek Wi-Fi 6 Adapter', operationalStatus: 1, adminStatus: 1, speedBps: 52_000_000, physicalAddress: 'AA:BB:CC:DD:EE:FF' },
    { interfaceIndex: 7, name: 'ethernet_32769', description: 'Realtek Ethernet', operationalStatus: 2, adminStatus: 1, speedBps: 1_000_000_000 },
  ]);
  assert.equal(selected.interfaceIndex, 18);
  assert.equal(selected.physicalAddress, 'AA:BB:CC:DD:EE:FF');
});

test('/24 discovery candidates can auto-bind multiple SNMP responders and leave others on ICMP', () => {
  const candidates = [
    { ipAddress: '192.168.26.80', snmpDiscovered: true, snmpInterfaceIndex: 18, snmpSysName: 'SIDRAM' },
    { ipAddress: '192.168.26.81', snmpDiscovered: true, snmpInterfaceIndex: 12, snmpSysName: 'LAB-PC' },
    { ipAddress: '192.168.26.82', snmpDiscovered: false, snmpInterfaceIndex: null, snmpSysName: null },
  ].map((candidate) => ({
    ...candidate,
    monitoringMethod: candidate.snmpDiscovered ? 'snmp' : 'icmp',
  }));

  assert.deepEqual(candidates.map(({ ipAddress, monitoringMethod }) => [ipAddress, monitoringMethod]), [
    ['192.168.26.80', 'snmp'],
    ['192.168.26.81', 'snmp'],
    ['192.168.26.82', 'icmp'],
  ]);
});

test('hotspot IP reconciliation updates the enrolled device in place and preserves SNMP configuration', async () => {
  let saveCount = 0;
  const device = {
    _id: 'device-1',
    ipAddress: '192.168.43.20',
    macAddress: 'AA:BB:CC:DD:EE:FF',
    snmpSysName: 'phone-router',
    snmpCommunity: 'enc:v1:community-ciphertext',
    snmpInterfaceIndex: 7,
    snmpVersion: '2c',
    subnet: 'subnet-1',
    async save() {
      saveCount += 1;
    },
  };
  const candidate = {
    ipAddress: '192.168.43.21',
    macAddress: 'aa-bb-cc-dd-ee-ff',
    snmpSysName: 'Phone-Router',
  };

  const match = findIdentityMatch(
    candidate,
    [device],
    new Set(['192.168.43.1', '192.168.43.21']),
    'subnet-1',
  );
  assert.equal(match, device);

  const result = await reconcileDeviceIdentity(device, candidate, {
    subnetId: 'subnet-1',
    now: new Date('2026-11-20T14:00:00.000Z'),
  });

  assert.equal(result.changed, true);
  assert.equal(device.ipAddress, '192.168.43.21');
  assert.equal(device.snmpCommunity, 'enc:v1:community-ciphertext');
  assert.equal(device.snmpInterfaceIndex, 7);
  assert.equal(device.snmpSysName, 'Phone-Router');
  assert.deepEqual(device.ipAddressChanges, [{
    previousIpAddress: '192.168.43.20',
    newIpAddress: '192.168.43.21',
    reason: 'approved-subnet-discovery',
    observedAt: new Date('2026-11-20T14:00:00.000Z'),
  }]);
  assert.equal(saveCount, 1);
});

test('identity reconciliation does not cross the approved subnet boundary', () => {
  const match = findIdentityMatch(
    {
      ipAddress: '192.168.43.21',
      macAddress: 'aa-bb-cc-dd-ee-ff',
      snmpSysName: 'phone-router',
    },
    [{
      _id: 'device-1',
      ipAddress: '10.0.0.20',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      snmpSysName: 'phone-router',
      subnet: 'other-subnet',
    }],
    new Set(['192.168.43.21']),
    'subnet-1',
  );

  assert.equal(match, null);
});
