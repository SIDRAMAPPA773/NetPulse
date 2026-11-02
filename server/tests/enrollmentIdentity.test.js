const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const Subnet = require('../models/Subnet');
const { enrollMultipleDevices } = require('../controllers/deviceController');

test('batch enrollment does not duplicate a device already matched by IP', async (t) => {
  const originalFindOne = Device.findOne;
  const originalCreate = Device.create;
  const originalSubnetFind = Subnet.find;
  const existing = { _id: 'existing-id', ipAddress: '10.38.27.142' };
  const approvedSubnet = {
    _id: 'approved-subnet',
    cidr: '10.38.27.0/24',
    status: 'active',
    approvalStatus: 'approved',
  };
  let createCalled = false;

  t.after(() => {
    Device.findOne = originalFindOne;
    Device.create = originalCreate;
    Subnet.find = originalSubnetFind;
  });

  Subnet.find = () => ({ lean: async () => [approvedSubnet] });
  Device.findOne = async ({ ipAddress }) => (ipAddress === existing.ipAddress ? existing : null);
  Device.create = async () => {
    createCalled = true;
    throw new Error('Already-enrolled target should not be recreated');
  };

  let responseBody;
  const response = {
    status() {
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };
  await enrollMultipleDevices({
    body: { devices: [{ ipAddress: existing.ipAddress }] },
  }, response);

  assert.equal(createCalled, false);
  assert.equal(responseBody.devices.length, 0);
  assert.match(responseBody.message, /0 devices/);
});
