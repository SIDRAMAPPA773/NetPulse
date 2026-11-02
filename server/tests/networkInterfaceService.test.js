const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectNetworkInterfaces,
  getDiscoveryInterfaceEligibility,
  getPolicyEligibleInterface,
  inferInterfaceType,
  ipv4Cidr,
  parseLinuxInterfaceData,
  parseWindowsInterfaceData,
} = require('../utils/networkInterfaceService');

test('IPv4 interface masks produce canonical network CIDRs', () => {
  assert.equal(ipv4Cidr('192.168.10.42', '255.255.255.0'), '192.168.10.0/24');
  assert.equal(ipv4Cidr('10.2.3.4', '255.255.0.0'), '10.2.0.0/16');
  assert.equal(ipv4Cidr('10.2.3.4', '255.0.255.0'), null);
});

test('interface type inference labels common link types without claiming device identity', () => {
  assert.equal(inferInterfaceType('Wi-Fi'), 'wireless');
  assert.equal(inferInterfaceType('Ethernet 2'), 'ethernet');
  assert.equal(inferInterfaceType('vEthernet (Default Switch)'), 'virtual');
  assert.equal(inferInterfaceType('Adapter 4'), 'unknown');
  assert.equal(inferInterfaceType('Local Area Connection* 9'), 'hotspot');
  assert.equal(inferInterfaceType('rmnet_data0'), 'hotspot');
  assert.equal(inferInterfaceType('vEthernet (Work VPN)'), 'virtual');
  assert.equal(inferInterfaceType('Loopback Pseudo-Interface 1'), 'loopback');
});

test('only active eligible private interfaces can be submitted for subnet approval', () => {
  const activeInterface = {
    type: 'wireless',
    status: 'up',
    discoveryCidr: '10.38.27.0/24',
    ipv4: [{ address: '10.38.27.191', internal: false }],
  };
  assert.equal(getDiscoveryInterfaceEligibility(activeInterface).state, 'eligible_for_authorization');
  assert.equal(getDiscoveryInterfaceEligibility({
    ...activeInterface,
    type: 'hotspot',
    discoveryCidr: '192.168.137.0/24',
  }).state, 'eligible_for_authorization');
  assert.equal(getDiscoveryInterfaceEligibility({
    ...activeInterface,
    type: 'virtual',
  }).state, 'review_required');
  assert.equal(getDiscoveryInterfaceEligibility({
    ...activeInterface,
    type: 'loopback',
    discoveryCidr: '127.0.0.0/8',
    ipv4: [{ address: '127.0.0.1', internal: true }],
  }).state, 'excluded');
  assert.equal(getDiscoveryInterfaceEligibility({
    ...activeInterface,
    discoveryCidr: '10.0.0.0/8',
  }).state, 'excluded');
});

test('automatic interface authorization requires an explicitly selected type and safe bounded private range', () => {
  const policy = {
    autoAuthorizeInterfaces: true,
    interfaceTypes: ['wireless'],
    maxHosts: 256,
  };
  const wifi = {
    type: 'wireless',
    status: 'up',
    discoveryCidr: '10.38.27.0/24',
    ipv4: [{ address: '10.38.27.191', internal: false }],
  };
  assert.equal(getPolicyEligibleInterface(wifi, policy).eligible, true);
  assert.equal(getPolicyEligibleInterface({ ...wifi, type: 'ethernet' }, policy).eligible, false);
  assert.equal(getPolicyEligibleInterface({ ...wifi, status: 'unknown' }, policy).eligible, false);
  assert.equal(getPolicyEligibleInterface({ ...wifi, discoveryCidr: '169.254.1.0/24' }, policy).eligible, false);
  assert.equal(getPolicyEligibleInterface({ ...wifi, discoveryCidr: '192.168.0.0/16' }, policy).eligible, false);
  assert.equal(getPolicyEligibleInterface({
    ...wifi,
    type: 'virtual',
  }, { ...policy, interfaceTypes: ['virtual'] }).eligible, true);
});

test('Windows interface information parses link state and default route', () => {
  const parsed = parseWindowsInterfaceData(
    JSON.stringify([{ Name: 'Ethernet', Status: 'Up', InterfaceDescription: 'Intel Ethernet Adapter' }]),
    JSON.stringify([{ InterfaceAlias: 'Ethernet', NextHop: '192.168.10.1' }]),
  );
  assert.deepEqual(parsed.states.get('Ethernet'), {
    status: 'up',
    description: 'Intel Ethernet Adapter',
  });
  assert.equal(parsed.gateways.get('Ethernet'), '192.168.10.1');
});

test('Linux interface information parses operational state and route gateway', () => {
  const parsed = parseLinuxInterfaceData(
    JSON.stringify([{ ifname: 'wlan0', operstate: 'UP' }]),
    JSON.stringify([{ dev: 'wlan0', gateway: '10.0.0.1' }]),
  );
  assert.equal(parsed.states.get('wlan0').status, 'up');
  assert.equal(parsed.gateways.get('wlan0'), '10.0.0.1');
});

test('interface preview includes IPv4 and IPv6 and never starts discovery probes', async () => {
  const interfaces = await detectNetworkInterfaces({
    platform: 'unsupported-test-platform',
    networkInterfaces: {
      Ethernet: [
        { address: '192.168.10.42', netmask: '255.255.255.0', cidr: '192.168.10.42/24', family: 'IPv4', internal: false },
        { address: 'fe80::1234', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false, scopeid: 7 },
      ],
    },
  });
  assert.equal(interfaces[0].discoveryCidr, '192.168.10.0/24');
  assert.equal(interfaces[0].ipv4[0].address, '192.168.10.42');
  assert.equal(interfaces[0].ipv6[0].address, 'fe80::1234');
  assert.equal(interfaces[0].status, 'unknown');
  assert.equal(interfaces[0].defaultGateway, null);
});

test('interface detection preserves each configured IPv4 network on a multi-address interface', async () => {
  const interfaces = await detectNetworkInterfaces({
    platform: 'unsupported-test-platform',
    networkInterfaces: {
      Ethernet: [
        { address: '10.20.1.10', netmask: '255.255.255.0', family: 'IPv4', internal: false },
        { address: '192.168.10.10', netmask: '255.255.255.0', family: 'IPv4', internal: false },
      ],
    },
  });
  assert.deepEqual(interfaces.map((networkInterface) => networkInterface.discoveryCidr), [
    '10.20.1.0/24',
    '192.168.10.0/24',
  ]);
});
