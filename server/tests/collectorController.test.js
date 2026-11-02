const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const mongoose = require('mongoose');
const Collector = require('../models/Collector');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Subnet = require('../models/Subnet');
const Setting = require('../models/Setting');
const Alert = require('../models/Alert');
const socketService = require('../services/socketService');
const { hashCollectorToken } = require('../utils/collectorToken');
const {
  collectorHeartbeat,
  createCollector,
  revokeCollector,
} = require('../controllers/collectorController');

function makeResponse() {
  return {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('admin collector registration binds one token to an approved bounded subnet', async (t) => {
  const originals = {
    subnetFindById: Subnet.findById,
    collectorFindOne: Collector.findOne,
    collectorCreate: Collector.create,
    collectorFindById: Collector.findById,
    deviceUpdateMany: Device.updateMany,
    consoleInfo: console.info,
  };
  const subnetId = new mongoose.Types.ObjectId();
  const collectorId = new mongoose.Types.ObjectId();
  const subnet = {
    _id: subnetId,
    name: 'Site network',
    cidr: '192.168.44.0/29',
    usableHostCount: 6,
    status: 'active',
    approvalStatus: 'approved',
    monitoringEnabled: true,
  };
  let created;
  let assigned;
  t.after(() => {
    Subnet.findById = originals.subnetFindById;
    Collector.findOne = originals.collectorFindOne;
    Collector.create = originals.collectorCreate;
    Collector.findById = originals.collectorFindById;
    Device.updateMany = originals.deviceUpdateMany;
    console.info = originals.consoleInfo;
  });
  Subnet.findById = async () => subnet;
  Collector.findOne = async () => null;
  Collector.create = async (data) => {
    created = { ...data, _id: collectorId };
    return created;
  };
  Collector.findById = () => ({
    select() { return this; },
    populate: async () => ({
      ...created,
      subnet,
      toObject() { return { ...this }; },
    }),
  });
  Device.updateMany = async (filter, update) => { assigned = { filter, update }; };
  console.info = () => {};

  const response = makeResponse();
  await createCollector({
    user: { _id: new mongoose.Types.ObjectId() },
    body: { name: 'Remote lab', subnetId: String(subnetId) },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.collector.name, 'Remote lab');
  assert.equal(response.body.collector.tokenHash, undefined);
  assert.equal(created.tokenHash, hashCollectorToken(response.body.token));
  assert.notEqual(created.tokenHash, response.body.token);
  assert.deepEqual(assigned, {
    filter: { subnet: subnetId, enrollmentStatus: 'approved', monitoringStatus: true },
    update: { $set: { collectorId } },
  });
});

test('collector heartbeat accepts only its exact approved scope', async (t) => {
  const originalFindById = Subnet.findById;
  const subnet = {
    _id: new mongoose.Types.ObjectId(),
    cidr: '192.168.44.0/29',
    usableHostCount: 6,
    status: 'active',
    approvalStatus: 'approved',
    monitoringEnabled: true,
  };
  let saved = false;
  const collector = {
    subnet: subnet._id,
    save: async () => { saved = true; },
  };
  t.after(() => { Subnet.findById = originalFindById; });
  Subnet.findById = async () => subnet;

  const response = makeResponse();
  await collectorHeartbeat({
    collector,
    body: { agentVersion: '1.0.0', subnetCidr: subnet.cidr, activeTargets: 6 },
  }, response);
  assert.equal(response.statusCode, undefined);
  assert.equal(response.body.accepted, true);
  assert.equal(saved, true);
  assert.equal(collector.agentVersion, '1.0.0');

  const invalidResponse = makeResponse();
  await collectorHeartbeat({
    collector,
    body: { agentVersion: '1.0.0', subnetCidr: '192.168.45.0/29', activeTargets: 6 },
  }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
});

test('revoking a collector releases its device assignments idempotently', async (t) => {
  const originalFindById = Collector.findById;
  const originalUpdateMany = Device.updateMany;
  const originalInfo = console.info;
  const collector = {
    _id: new mongoose.Types.ObjectId(),
    subnet: new mongoose.Types.ObjectId(),
    status: 'active',
    save: async function save() {},
    toObject() { return { _id: this._id, status: this.status, tokenHash: 'never-return' }; },
  };
  let released;
  t.after(() => {
    Collector.findById = originalFindById;
    Device.updateMany = originalUpdateMany;
    console.info = originalInfo;
  });
  Collector.findById = async () => collector;
  Device.updateMany = async (filter, update) => { released = { filter, update }; };
  console.info = () => {};

  const response = makeResponse();
  await revokeCollector({
    params: { id: String(collector._id) },
    user: { _id: new mongoose.Types.ObjectId() },
  }, response);

  assert.equal(response.body.collector.tokenHash, undefined);
  assert.equal(collector.status, 'revoked');
  assert.deepEqual(released, {
    filter: { collectorId: collector._id },
    update: { $set: { collectorId: null } },
  });
});

test('collector reports persist bounded telemetry and use the shared failure hysteresis', async (t) => {
  const originals = {
    subnetFindById: Subnet.findById,
    deviceFindOne: Device.findOne,
    metricCreate: Metric.create,
    settingFind: Setting.find,
    alertFindOne: Alert.findOne,
    alertFindById: Alert.findById,
    alertCreate: Alert.create,
    alertUpdateMany: Alert.updateMany,
  };
  const subnetId = new mongoose.Types.ObjectId();
  const collectorId = new mongoose.Types.ObjectId();
  const deviceId = new mongoose.Types.ObjectId();
  const subnet = {
    _id: subnetId,
    cidr: '192.168.44.0/29',
    status: 'active',
    approvalStatus: 'approved',
    monitoringEnabled: true,
  };
  const device = {
    _id: deviceId,
    name: 'Existing switch',
    ipAddress: '192.168.44.1',
    subnet: subnetId,
    collectorId,
    enrollmentStatus: 'approved',
    monitoringStatus: true,
    status: 'UP',
    consecutiveFailureCount: 0,
    consecutiveRecoveryCount: 0,
    save: async () => {},
    toJSON() {
      return { _id: this._id, status: this.status };
    },
  };
  const collector = {
    _id: collectorId,
    subnet: subnetId,
    save: async () => {},
  };
  const metrics = [];
  const server = http.createServer();
  const io = socketService.init(server, []);
  t.after(() => {
    io.close();
    Subnet.findById = originals.subnetFindById;
    Device.findOne = originals.deviceFindOne;
    Metric.create = originals.metricCreate;
    Setting.find = originals.settingFind;
    Alert.findOne = originals.alertFindOne;
    Alert.findById = originals.alertFindById;
    Alert.create = originals.alertCreate;
    Alert.updateMany = originals.alertUpdateMany;
  });
  Subnet.findById = async () => subnet;
  Device.findOne = async () => device;
  Metric.create = async (data) => {
    const metric = { ...data, _id: new mongoose.Types.ObjectId() };
    metrics.push(metric);
    return metric;
  };
  Setting.find = async () => [];
  Alert.findOne = async () => null;
  Alert.findById = () => ({ populate: async () => ({ _id: 'alert-id' }) });
  Alert.create = async (data) => ({ ...data, _id: new mongoose.Types.ObjectId() });
  Alert.updateMany = async () => ({ modifiedCount: 0 });

  const { collectorReport } = require('../controllers/collectorController');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const observedAt = new Date(Date.now() - 3_000 + attempt * 1_000).toISOString();
    const response = makeResponse();
    await collectorReport({
      collector,
      body: {
        observations: [{
          ipAddress: device.ipAddress,
          reachable: false,
          latencyMs: null,
          packetLoss: 100,
          observedAt,
        }],
      },
    }, response);
    assert.equal(response.statusCode, undefined);
    assert.equal(response.body.accepted, 1);
  }

  assert.equal(device.status, 'DOWN');
  assert.equal(device.consecutiveFailureCount, 3);
  assert.equal(metrics.length, 3);
  assert.equal(metrics[0].source, 'https-collector');
  assert.equal(metrics.at(-1).status, 'DOWN');
  assert.equal(metrics.at(-1).reachability.isReachable, false);
});
