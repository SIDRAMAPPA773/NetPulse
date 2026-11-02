const test = require('node:test');
const assert = require('node:assert/strict');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const networkInterfaceService = require('../utils/networkInterfaceService');
const { getNetworkInterfaces } = require('../controllers/deviceController');

const originalDetect = networkInterfaceService.detectNetworkInterfaces;
const originalSubnetFind = Subnet.find;
const originalSubnetFindById = Subnet.findById;
const originalSettingFindOne = Setting.findOne;
const originalDiscoveryAllowlist = process.env.DISCOVERY_ALLOWLIST;

function makeInterface(name, type, status, address, cidr, internal = false) {
  return {
    name,
    type,
    status,
    description: null,
    defaultGateway: null,
    ipv4: [{ address, family: 'IPv4', netmask: '255.255.255.0', cidr, internal }],
    ipv6: [],
    discoveryCidr: cidr,
  };
}

async function getInterfaceResponse() {
  let responseBody;
  const response = {
    json(value) {
      responseBody = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  await getNetworkInterfaces({}, response);
  return { body: responseBody, statusCode: response.statusCode || 200 };
}

test.after(() => {
  networkInterfaceService.detectNetworkInterfaces = originalDetect;
  Subnet.find = originalSubnetFind;
  Subnet.findById = originalSubnetFindById;
  Setting.findOne = originalSettingFindOne;
  if (originalDiscoveryAllowlist === undefined) delete process.env.DISCOVERY_ALLOWLIST;
  else process.env.DISCOVERY_ALLOWLIST = originalDiscoveryAllowlist;
});

test('discovery endpoint rejects a requested CIDR outside the selected subnet before probing', async (t) => {
  const subnet = {
    _id: '000000000000000000000001',
    cidr: '10.38.27.0/24',
    status: 'active',
    approvalStatus: 'approved',
  };
  Subnet.findById = async () => subnet;
  let responseBody;
  const response = {
    json(value) {
      responseBody = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  const { discoverLocalDevices } = require('../controllers/deviceController');

  await discoverLocalDevices({
    body: { subnetId: subnet._id, cidr: '10.38.28.0/24' },
    user: { _id: 'admin-id' },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.match(responseBody.message, /does not match the selected subnet/);
});

test('network interface API authorizes approved private Wi-Fi and hotspot CIDRs without per-IP allowlist', async (t) => {
  const interfaces = [
    makeInterface('Wi-Fi', 'wireless', 'up', '10.38.27.191', '10.38.27.0/24'),
    makeInterface('Local Area Connection* 9', 'hotspot', 'up', '192.168.137.1', '192.168.137.0/24'),
    makeInterface('Loopback Pseudo-Interface 1', 'loopback', 'unknown', '127.0.0.1', '127.0.0.0/8', true),
  ];
  networkInterfaceService.detectNetworkInterfaces = async () => interfaces;
  const records = [
    { _id: 'wifi-subnet', cidr: '10.38.27.0/24', status: 'active', approvalStatus: 'approved' },
    { _id: 'hotspot-subnet', cidr: '192.168.137.0/24', status: 'active', approvalStatus: 'approved' },
  ];
  Subnet.find = () => ({ lean: async () => records });
  Setting.findOne = async () => ({ value: 'subnet_registry' });
  process.env.DISCOVERY_ALLOWLIST = '';

  const response = await getInterfaceResponse();
  assert.equal(response.statusCode, 200);
  const byCidr = new Map(response.body.interfaces.map((item) => [item.discoveryCidr, item]));
  for (const cidr of ['10.38.27.0/24', '192.168.137.0/24']) {
    assert.equal(byCidr.get(cidr).authorizationStatus, 'authorized');
    assert.equal(byCidr.get(cidr).discoveryApproved, true);
    assert.equal(byCidr.get(cidr).canRegisterSubnet, false);
  }
  assert.equal(byCidr.get('10.38.27.0/24').discoveryHostCount, 254);
  assert.equal(byCidr.get('192.168.137.0/24').discoveryHostCount, 254);
  assert.equal(byCidr.get('127.0.0.0/8').authorizationStatus, 'excluded');
  assert.equal(byCidr.get('127.0.0.0/8').discoveryApproved, false);
});

test('network interface API reports pending, disabled, and environment-restricted authorization accurately', async (t) => {
  const interfaces = [
    makeInterface('Wi-Fi', 'wireless', 'up', '10.38.27.191', '10.38.27.0/24'),
    makeInterface('Ethernet', 'ethernet', 'up', '192.168.137.1', '192.168.137.0/24'),
    makeInterface('Ethernet 2', 'ethernet', 'up', '192.168.50.1', '192.168.50.0/24'),
  ];
  networkInterfaceService.detectNetworkInterfaces = async () => interfaces;
  const records = [
    { _id: 'pending', cidr: '10.38.27.0/24', status: 'active', approvalStatus: 'pending' },
    { _id: 'disabled', cidr: '192.168.137.0/24', status: 'disabled', approvalStatus: 'approved' },
    { _id: 'approved', cidr: '192.168.50.0/24', status: 'active', approvalStatus: 'approved' },
  ];
  Subnet.find = () => ({ lean: async () => records });
  Setting.findOne = async () => ({ value: 'dual' });
  process.env.DISCOVERY_ALLOWLIST = '';

  const response = await getInterfaceResponse();
  const byCidr = new Map(response.body.interfaces.map((item) => [item.discoveryCidr, item]));
  assert.equal(byCidr.get('10.38.27.0/24').authorizationStatus, 'pending_approval');
  assert.equal(byCidr.get('192.168.137.0/24').authorizationStatus, 'disabled');
  assert.equal(byCidr.get('192.168.50.0/24').authorizationStatus, 'environment_restricted');
  assert.equal(byCidr.get('192.168.50.0/24').discoveryApproved, false);
});

test('network interface API exposes scoped automatic authorization without environment CIDRs', async (t) => {
  networkInterfaceService.detectNetworkInterfaces = async () => [
    makeInterface('Wi-Fi', 'wireless', 'up', '10.38.27.191', '10.38.27.0/24'),
    makeInterface('VPN', 'virtual', 'up', '172.20.1.2', '172.20.1.0/24'),
    makeInterface('Loopback', 'loopback', 'unknown', '127.0.0.1', '127.0.0.0/8', true),
  ];
  Subnet.find = () => ({ lean: async () => [] });
  Setting.findOne = async ({ key }) => (key === 'NETWORK_AUTHORIZATION_POLICY'
    ? {
      value: {
        mode: 'application_managed',
        autoAuthorizeInterfaces: true,
        interfaceTypes: ['wireless'],
        maxHosts: 256,
      },
    }
    : { value: 'dual' });
  process.env.DISCOVERY_ALLOWLIST = '';

  const response = await getInterfaceResponse();
  const byCidr = new Map(response.body.interfaces.map((item) => [item.discoveryCidr, item]));

  assert.equal(byCidr.get('10.38.27.0/24').authorizationStatus, 'eligible_for_auto_authorization');
  assert.equal(byCidr.get('10.38.27.0/24').automaticAuthorizationEligible, true);
  assert.equal(byCidr.get('10.38.27.0/24').canRegisterSubnet, false);
  assert.equal(byCidr.get('172.20.1.0/24').automaticAuthorizationEligible, false);
  assert.equal(byCidr.get('127.0.0.0/8').authorizationStatus, 'excluded');
});
