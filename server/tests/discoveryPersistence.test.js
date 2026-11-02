const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const DiscoveryJob = require('../models/DiscoveryJob');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const icmpProbe = require('../utils/icmpProbe');
const neighbourService = require('../utils/neighbourService');
const socketService = require('../services/socketService');
const { discoverLocalDevices, getDiscoveryJobs } = require('../controllers/deviceController');

test('approved discovery persists bounded results and emits progress without duplicate IPs', async (t) => {
  const originals = {
    deviceFind: Device.find,
    subnetFind: Subnet.find,
    subnetFindById: Subnet.findById,
    jobCreate: DiscoveryJob.create,
    jobExists: DiscoveryJob.exists,
    jobFind: DiscoveryJob.find,
    jobUpdateOne: DiscoveryJob.updateOne,
    settingFindOne: Setting.findOne,
    probeIcmp: icmpProbe.probeIcmp,
    getNeighbourTable: neighbourService.getNeighbourTable,
    getIO: socketService.getIO,
    discoveryAllowlist: process.env.DISCOVERY_ALLOWLIST,
    monitoringAllowlist: process.env.MONITORING_TARGET_ALLOWLIST,
  };
  const progressEvents = [];
  let savedJob;
  t.after(() => {
    Device.find = originals.deviceFind;
    Subnet.find = originals.subnetFind;
    Subnet.findById = originals.subnetFindById;
    DiscoveryJob.create = originals.jobCreate;
    DiscoveryJob.exists = originals.jobExists;
    DiscoveryJob.find = originals.jobFind;
    DiscoveryJob.updateOne = originals.jobUpdateOne;
    Setting.findOne = originals.settingFindOne;
    icmpProbe.probeIcmp = originals.probeIcmp;
    neighbourService.getNeighbourTable = originals.getNeighbourTable;
    socketService.getIO = originals.getIO;
    if (originals.discoveryAllowlist === undefined) delete process.env.DISCOVERY_ALLOWLIST;
    else process.env.DISCOVERY_ALLOWLIST = originals.discoveryAllowlist;
    if (originals.monitoringAllowlist === undefined) delete process.env.MONITORING_TARGET_ALLOWLIST;
    else process.env.MONITORING_TARGET_ALLOWLIST = originals.monitoringAllowlist;
  });

  process.env.DISCOVERY_ALLOWLIST = '192.168.10.0/30';
  process.env.MONITORING_TARGET_ALLOWLIST = '192.168.10.0/30';
  Setting.findOne = async ({ key }) => ({
    key,
    value: key === 'SIMULATION_MODE' ? false : false,
  });
  const deviceQuery = { select: async () => [] };
  Device.find = () => deviceQuery;
  const subnet = {
    _id: 'subnet-id',
    cidr: '192.168.10.0/30',
    status: 'active',
    approvalStatus: 'approved',
    autoEnroll: false,
    monitoringEnabled: false,
    async save() {},
  };
  Subnet.findById = async () => subnet;
  Subnet.find = () => ({
    lean: async () => [subnet],
  });
  DiscoveryJob.exists = async () => null;
  neighbourService.getNeighbourTable = async () => new Map();
  DiscoveryJob.create = async (document) => {
    savedJob = {
      ...document,
      _id: 'discovery-job-1',
      save: async () => {},
    };
    return savedJob;
  };
  DiscoveryJob.updateOne = async () => ({ acknowledged: true });
  DiscoveryJob.find = () => ({
    sort() { return this; },
    limit() { return this; },
    select() { return this; },
    lean: async () => [],
  });
  icmpProbe.probeIcmp = async (ipAddress) => ({
    probeCount: 1,
    reachable: ipAddress === '192.168.10.1',
    rttAvg: ipAddress === '192.168.10.1' ? 4 : null,
  });
  socketService.getIO = () => ({
    to: () => ({ emit: (...event) => progressEvents.push(event) }),
  });

  let responseBody;
  const response = {
    writableEnded: false,
    destroyed: false,
    headersSent: false,
    on() {},
    json(value) {
      responseBody = value;
      this.writableEnded = true;
      return this;
    },
    status() {
      return this;
    },
  };

  await discoverLocalDevices({
    body: { subnetId: '000000000000000000000001', cidr: '192.168.10.0/30' },
    user: { _id: 'admin-id' },
  }, response);

  assert.equal(savedJob.status, 'completed');
  assert.equal(savedJob.totalHosts, 2);
  assert.equal(savedJob.checkedHosts, 2);
  assert.equal(savedJob.respondingHosts, 1);
  assert.equal(savedJob.results.length, 1);
  assert.equal(savedJob.results[0].ipAddress, '192.168.10.1');
  assert.equal(responseBody.jobId, 'discovery-job-1');
  assert.equal(responseBody.count, 1);
  assert.ok(progressEvents.some(([name]) => name === 'discoveryProgress'));
});

test('discovery history endpoint returns a bounded recent job list', async (t) => {
  const originalFind = DiscoveryJob.find;
  t.after(() => {
    DiscoveryJob.find = originalFind;
  });
  let appliedLimit;
  DiscoveryJob.find = () => ({
    sort() { return this; },
    limit(value) {
      appliedLimit = value;
      return this;
    },
    select() { return this; },
    lean: async () => [{ _id: 'job-id', status: 'completed' }],
  });
  let responseBody;
  await getDiscoveryJobs({}, {
    json(value) { responseBody = value; return this; },
    status() { return this; },
  });
  assert.equal(appliedLimit, 20);
  assert.equal(responseBody[0].status, 'completed');
});
