const test = require('node:test');
const assert = require('node:assert/strict');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const networkInterfaceService = require('../utils/networkInterfaceService');
const { synchronizeConnectedInterfaces } = require('../services/interfaceAuthorizationService');

const originalSettingFindOne = Setting.findOne;
const originalSubnetFind = Subnet.find;
const originalSubnetCreate = Subnet.create;
const originalSubnetUpdateOne = Subnet.updateOne;
const originalDetectNetworkInterfaces = networkInterfaceService.detectNetworkInterfaces;

test.after(() => {
  Setting.findOne = originalSettingFindOne;
  Subnet.find = originalSubnetFind;
  Subnet.create = originalSubnetCreate;
  Subnet.updateOne = originalSubnetUpdateOne;
  networkInterfaceService.detectNetworkInterfaces = originalDetectNetworkInterfaces;
});

test('application policy authorizes only scoped connected private interfaces without environment allowlists', async (t) => {
  const actorId = '507f1f77bcf86cd799439011';
  const records = [];
  const created = [];
  let detected = 0;
  t.after(() => {
    Setting.findOne = originalSettingFindOne;
    Subnet.find = originalSubnetFind;
    Subnet.create = originalSubnetCreate;
    Subnet.updateOne = originalSubnetUpdateOne;
    networkInterfaceService.detectNetworkInterfaces = originalDetectNetworkInterfaces;
  });

  Setting.findOne = async () => ({
    value: {
      mode: 'application_managed',
      autoAuthorizeInterfaces: true,
      interfaceTypes: ['wireless', 'hotspot'],
      maxHosts: 256,
      configuredBy: actorId,
    },
  });
  Subnet.find = () => ({ lean: async () => records.map((subnet) => ({ ...subnet })) });
  Subnet.create = async (subnet) => {
    const stored = { ...subnet, _id: `managed-${created.length}` };
    created.push(stored);
    records.push(stored);
    return stored;
  };
  Subnet.updateOne = async () => ({ modifiedCount: 1 });
  networkInterfaceService.detectNetworkInterfaces = async () => {
    detected += 1;
    return [
      {
        name: 'Wi-Fi',
        type: 'wireless',
        status: 'up',
        discoveryCidr: '10.38.27.0/24',
        ipv4: [{ address: '10.38.27.191', internal: false }],
      },
      {
        name: 'Mobile Hotspot',
        type: 'hotspot',
        status: 'up',
        discoveryCidr: '192.168.137.0/24',
        ipv4: [{ address: '192.168.137.1', internal: false }],
      },
      {
        name: 'Work VPN',
        type: 'virtual',
        status: 'up',
        discoveryCidr: '172.20.1.0/24',
        ipv4: [{ address: '172.20.1.2', internal: false }],
      },
      {
        name: 'Link Local',
        type: 'ethernet',
        status: 'up',
        discoveryCidr: '169.254.1.0/24',
        ipv4: [{ address: '169.254.1.2', internal: false }],
      },
      {
        name: 'Disconnected Ethernet',
        type: 'ethernet',
        status: 'down',
        discoveryCidr: '10.1.1.0/24',
        ipv4: [{ address: '10.1.1.1', internal: false }],
      },
    ];
  };

  const result = await synchronizeConnectedInterfaces({ trigger: 'test' });

  assert.equal(detected, 1);
  assert.equal(result.authorized, 2);
  assert.equal(result.skippedInterfaces, 0);
  assert.deepEqual(created.map(({ cidr }) => cidr), ['10.38.27.0/24', '192.168.137.0/24']);
  for (const subnet of created) {
    assert.equal(subnet.approvalStatus, 'approved');
    assert.equal(subnet.status, 'active');
    assert.equal(subnet.authorizationSource, 'interface_policy');
    assert.equal(String(subnet.createdBy), actorId);
    assert.equal(subnet.monitoringEnabled, false);
    assert.equal(subnet.discoveryScheduleEnabled, false);
    assert.equal(subnet.autoEnroll, false);
    assert.equal(subnet.requireEnrollmentApproval, true);
    assert.ok(subnet.usableHostCount <= 256);
  }
});

test('disabled automatic authorization does not inspect or authorize interfaces', async (t) => {
  const records = [];
  let detected = 0;
  t.after(() => {
    Setting.findOne = originalSettingFindOne;
    Subnet.find = originalSubnetFind;
    Subnet.updateOne = originalSubnetUpdateOne;
    networkInterfaceService.detectNetworkInterfaces = originalDetectNetworkInterfaces;
  });
  Setting.findOne = async () => ({ value: { mode: 'legacy_allowlists', autoAuthorizeInterfaces: false } });
  Subnet.find = () => ({ lean: async () => records });
  Subnet.updateOne = async () => ({ modifiedCount: 0 });
  networkInterfaceService.detectNetworkInterfaces = async () => {
    detected += 1;
    return [];
  };

  const result = await synchronizeConnectedInterfaces();

  assert.equal(detected, 0);
  assert.equal(result.authorized, 0);
  assert.equal(result.reason, 'application_managed_mode_disabled');
});

test('explicit auto-authorization policy can approve an exact pending subnet without scanning', async (t) => {
  const pending = {
    _id: 'existing-subnet',
    cidr: '192.168.137.0/24',
    status: 'active',
    approvalStatus: 'pending',
    authorizationSource: 'manual',
  };
  const updateCalls = [];
  let created = false;
  t.after(() => {
    Setting.findOne = originalSettingFindOne;
    Subnet.find = originalSubnetFind;
    Subnet.create = originalSubnetCreate;
    Subnet.updateOne = originalSubnetUpdateOne;
    networkInterfaceService.detectNetworkInterfaces = originalDetectNetworkInterfaces;
  });
  Setting.findOne = async () => ({
    value: {
      mode: 'application_managed',
      autoAuthorizeInterfaces: true,
      interfaceTypes: ['hotspot'],
      maxHosts: 256,
      configuredBy: '507f1f77bcf86cd799439011',
    },
  });
  Subnet.find = () => ({ lean: async () => [{ ...pending }] });
  Subnet.updateOne = async (filter, update) => {
    updateCalls.push({ filter, update });
    return { modifiedCount: 1 };
  };
  Subnet.create = async () => {
    created = true;
  };
  networkInterfaceService.detectNetworkInterfaces = async () => [{
    name: 'Mobile Hotspot',
    type: 'hotspot',
    status: 'up',
    discoveryCidr: '192.168.137.0/24',
    ipv4: [{ address: '192.168.137.1', internal: false }],
  }];

  const result = await synchronizeConnectedInterfaces({ trigger: 'admin-request' });

  assert.equal(result.authorized, 1);
  assert.equal(created, false);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].update.$set.approvalStatus, 'approved');
  assert.equal(updateCalls[0].update.$set.authorizationSource, 'interface_policy');
});
