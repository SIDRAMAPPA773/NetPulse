const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const Subnet = require('../models/Subnet');
const Device = require('../models/Device');
const Collector = require('../models/Collector');
const User = require('../models/User');
const DiscoveryJob = require('../models/DiscoveryJob');
const { calculateSubnet } = require('../controllers/subnetController');

function createQuery(rows) {
  return {
    sort() { return this; },
    select() { return this; },
    populate() { return this; },
    lean: async () => rows,
    then(resolve, reject) {
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
}

function makeDocument(data, records) {
  const document = {
    ...data,
    _id: data._id || `0000000000000000000000${String(records.length + 1).padStart(2, '0')}`,
    async save() {
      if (!records.includes(this)) records.push(this);
      return this;
    },
    populate() { return this; },
  };
  return document;
}

test('CIDR calculations cover common networks and boundary prefixes', () => {
  assert.deepEqual(calculateSubnet('192.168.50.0/24'), {
    cidr: '192.168.50.0/24',
    networkAddress: '192.168.50.0',
    subnetMask: '255.255.255.0',
    broadcastAddress: '192.168.50.255',
    firstUsableIp: '192.168.50.1',
    lastUsableIp: '192.168.50.254',
    totalAddressCount: 256,
    usableHostCount: 254,
    rangeStart: 3232248320,
    rangeEnd: 3232248575,
  });
  assert.equal(calculateSubnet('192.168.1.0/30').usableHostCount, 2);
  assert.equal(calculateSubnet('192.168.1.0/30').firstUsableIp, '192.168.1.1');
  assert.equal(calculateSubnet('192.168.1.0/31').usableHostCount, 2);
  assert.equal(calculateSubnet('192.168.1.0/31').firstUsableIp, '192.168.1.0');
  assert.equal(calculateSubnet('192.168.1.0/31').lastUsableIp, '192.168.1.1');
  assert.equal(calculateSubnet('192.168.1.1/32').usableHostCount, 1);
  assert.equal(calculateSubnet('192.168.1.1/32').lastUsableIp, '192.168.1.1');
  assert.match(calculateSubnet('192.168.1.1/24').error, /canonical/);
  assert.match(calculateSubnet('192.168.1.0/0').error, /canonical/);
  assert.match(calculateSubnet('10.0.0.0/23').error, /256/);
  assert.match(calculateSubnet('224.0.0.0/24').error, /unsafe/);
});

test('subnet API validates, persists, authorizes, approves, disables and deletes isolated records', async (t) => {
  const originalFind = Subnet.find;
  const originalFindById = Subnet.findById;
  const originalCreate = Subnet.create;
  const originalDeleteOne = Subnet.deleteOne;
  const originalDeviceAggregate = Device.aggregate;
  const originalDeviceUpdateMany = Device.updateMany;
  const originalCollectorUpdateMany = Collector.updateMany;
  const originalJobExists = DiscoveryJob.exists;
  const originalUserFindById = User.findById;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalConsoleInfo = console.info;
  const records = [];
  let runningDiscovery = false;
  let nextId = 1;
  const ids = {
    admin: '000000000000000000000001',
    viewer: '000000000000000000000002',
  };
  process.env.JWT_SECRET = 'subnet-test-secret-with-at-least-32-characters';
  console.info = () => {};

  Subnet.find = (filter = {}) => {
    const excludedId = filter._id?.$ne;
    return createQuery(records.filter((item) => !excludedId || String(item._id) !== String(excludedId)));
  };
  Device.aggregate = async () => [];
  Device.updateMany = async () => ({ modifiedCount: 0 });
  Collector.updateMany = async () => ({ modifiedCount: 0 });
  Subnet.findById = (id) => records.find((item) => String(item._id) === String(id)) || null;
  Subnet.create = async (data) => {
    if (records.some((item) => item.cidr === data.cidr)) {
      const error = new Error('Duplicate CIDR');
      error.code = 11000;
      throw error;
    }
    return makeDocument({ ...data, _id: `0000000000000000000000${String(nextId++).padStart(2, '0')}` }, records).save();
  };
  Subnet.deleteOne = async ({ _id }) => {
    const index = records.findIndex((item) => String(item._id) === String(_id));
    if (index >= 0) records.splice(index, 1);
  };
  DiscoveryJob.exists = async () => (runningDiscovery ? { _id: 'running-job' } : null);
  User.findById = (id) => ({
    select: async () => ({ _id: id, role: String(id) === ids.admin ? 'admin' : 'viewer' }),
  });

  const app = express();
  app.use(express.json());
  app.use('/api/subnets', require('../routes/subnetRoutes'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    Subnet.find = originalFind;
    Subnet.findById = originalFindById;
    Subnet.create = originalCreate;
    Subnet.deleteOne = originalDeleteOne;
    Device.aggregate = originalDeviceAggregate;
    Device.updateMany = originalDeviceUpdateMany;
    Collector.updateMany = originalCollectorUpdateMany;
    DiscoveryJob.exists = originalJobExists;
    User.findById = originalUserFindById;
    console.info = originalConsoleInfo;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/subnets`;
  const adminToken = jwt.sign({ id: ids.admin }, process.env.JWT_SECRET);
  const viewerToken = jwt.sign({ id: ids.viewer }, process.env.JWT_SECRET);
  const request = (path, method, token, body) => fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const viewerList = await request('', 'GET', viewerToken);
  assert.equal(viewerList.status, 200);
  const viewerCreate = await request('', 'POST', viewerToken, { name: 'Viewer subnet', cidr: '192.168.10.0/24' });
  assert.equal(viewerCreate.status, 401);

  const missingName = await request('', 'POST', adminToken, { cidr: '192.168.10.0/24' });
  assert.equal(missingName.status, 400);
  const malformed = await request('', 'POST', adminToken, { name: 'Malformed', cidr: 'not-a-cidr' });
  assert.equal(malformed.status, 400);
  const invalid = await request('', 'POST', adminToken, { name: 'Bad subnet', cidr: '192.168.10.1/24' });
  assert.equal(invalid.status, 400);
  const oversized = await request('', 'POST', adminToken, { name: 'Too large', cidr: '10.0.0.0/23' });
  assert.equal(oversized.status, 400);
  const unsafe = await request('', 'POST', adminToken, { name: 'Loopback', cidr: '127.0.0.0/24' });
  assert.equal(unsafe.status, 400);

  const createdResponse = await request('', 'POST', adminToken, {
    name: 'Engineering',
    cidr: '192.168.50.0/24',
    location: 'Building A',
    department: 'Engineering',
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const readResponse = await request(`/${created._id}`, 'GET', viewerToken);
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).name, 'Engineering');
  assert.equal(created.approvalStatus, 'pending');
  assert.equal(created.approvedBy, null);
  assert.equal(created.totalAddressCount, 256);
  assert.equal(created.usableHostCount, 254);
  assert.equal(created.subnetMask, '255.255.255.0');
  assert.equal(records.length, 1);

  const duplicate = await request('', 'POST', adminToken, { name: 'Duplicate', cidr: '192.168.50.0/24' });
  assert.equal(duplicate.status, 409);
  const overlapDenied = await request('', 'POST', adminToken, { name: 'Overlapping', cidr: '192.168.50.128/25' });
  assert.equal(overlapDenied.status, 409);
  const shortReason = await request('', 'POST', adminToken, {
    name: 'Short exception',
    cidr: '192.168.50.128/25',
    allowOverlap: true,
    overlapPermissionReason: 'ok',
  });
  assert.equal(shortReason.status, 409);
  const overlapPermitted = await request('', 'POST', adminToken, {
    name: 'Approved overlap exception',
    cidr: '192.168.50.128/25',
    allowOverlap: true,
    overlapPermissionReason: 'Documented delegated subnet exception',
  });
  assert.equal(overlapPermitted.status, 201);
  const overlap = await overlapPermitted.json();
  assert.equal(overlap.overlapPermitted, true);

  const viewerApproval = await request(`/${created._id}/approve`, 'POST', viewerToken);
  assert.equal(viewerApproval.status, 401);
  const approvalResponse = await request(`/${created._id}/approve`, 'POST', adminToken);
  assert.equal(approvalResponse.status, 200);
  const approved = await approvalResponse.json();
  assert.equal(approved.approvalStatus, 'approved');
  assert.equal(String(approved.approvedBy), ids.admin);
  assert.ok(approved.approvedAt);

  const changedCidr = await request(`/${created._id}`, 'PUT', adminToken, {
    cidr: '192.168.51.0/24',
  });
  assert.equal(changedCidr.status, 200);
  const edited = await changedCidr.json();
  assert.equal(edited.approvalStatus, 'pending');
  assert.equal(edited.approvedBy, null);
  assert.equal(edited.networkAddress, '192.168.51.0');

  const disableResponse = await request(`/${created._id}/disable`, 'POST', adminToken);
  assert.equal(disableResponse.status, 200);
  assert.equal((await disableResponse.json()).status, 'disabled');

  runningDiscovery = true;
  const blockedDelete = await request(`/${created._id}`, 'DELETE', adminToken);
  assert.equal(blockedDelete.status, 409);
  runningDiscovery = false;
  const deleteResponse = await request(`/${created._id}`, 'DELETE', adminToken);
  assert.equal(deleteResponse.status, 200);
  assert.equal(records.some((item) => String(item._id) === created._id), false);
});
