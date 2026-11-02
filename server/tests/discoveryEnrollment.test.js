const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const DiscoveryJob = require('../models/DiscoveryJob');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const icmpProbe = require('../utils/icmpProbe');
const neighbourService = require('../utils/neighbourService');
const socketService = require('../services/socketService');
const { runDiscoveryForSubnet, cancelDiscoveryJob } = require('../services/discoveryService');

let fixtureSequence = 0;

function installDiscoveryMocks(t, {
  subnetOverrides = {},
  existingDevices = [],
  neighborEntries = new Map(),
  probe,
  settingOverrides = {},
} = {}) {
  fixtureSequence += 1;
  const subnetId = `subnet-test-${fixtureSequence}`;
  const jobId = `000000000000000000000${String(fixtureSequence).padStart(3, '0')}`;
  const originals = {
    deviceFind: Device.find,
    deviceCreate: Device.create,
    subnetFind: Subnet.find,
    subnetFindById: Subnet.findById,
    jobCreate: DiscoveryJob.create,
    jobExists: DiscoveryJob.exists,
    jobUpdateOne: DiscoveryJob.updateOne,
    jobFindById: DiscoveryJob.findById,
    settingFindOne: Setting.findOne,
    icmpProbe: icmpProbe.probeIcmp,
    neighborTable: neighbourService.getNeighbourTable,
    getIO: socketService.getIO,
    discoveryAllowlist: process.env.DISCOVERY_ALLOWLIST,
    monitoringAllowlist: process.env.MONITORING_TARGET_ALLOWLIST,
  };
  const createdDevices = [];
  let nextJob;
  const subnet = {
    _id: subnetId,
    cidr: '10.88.0.1/32',
    status: 'active',
    approvalStatus: 'approved',
    location: 'Test lab',
    autoEnroll: false,
    requireEnrollmentApproval: true,
    monitoringEnabled: false,
    discoveryScheduleEnabled: false,
    discoveryIntervalMinutes: 60,
    async save() {},
    ...subnetOverrides,
  };
  process.env.DISCOVERY_ALLOWLIST = subnet.cidr;
  process.env.MONITORING_TARGET_ALLOWLIST = subnet.cidr;
  Subnet.findById = async () => subnet;
  Subnet.find = () => ({ lean: async () => [subnet] });
  Setting.findOne = async ({ key }) => ({ value: settingOverrides[key] ?? false });
  DiscoveryJob.exists = async () => null;
  DiscoveryJob.create = async (data) => {
    nextJob = {
      ...data,
      _id: jobId,
      async save() {},
    };
    return nextJob;
  };
  DiscoveryJob.findById = async (id) => (String(id) === String(nextJob?._id) ? nextJob : null);
  DiscoveryJob.updateOne = async () => ({ acknowledged: true });
  Device.find = (filter = {}) => ({
    select: async () => (filter.$or ? existingDevices : []),
  });
  Device.create = async (data) => {
    const device = {
      ...data,
      _id: `new-device-${createdDevices.length + 1}`,
      async save() {},
      toJSON() { return { ...this }; },
    };
    createdDevices.push(device);
    return device;
  };
  icmpProbe.probeIcmp = probe || (async () => ({
    reachable: true,
    rttAvg: 2,
    probeCount: 1,
    packetLoss: 0,
  }));
  neighbourService.getNeighbourTable = async () => neighborEntries;
  socketService.getIO = () => ({ to: () => ({ emit() {} }) });

  t.after(() => {
    Device.find = originals.deviceFind;
    Device.create = originals.deviceCreate;
    Subnet.find = originals.subnetFind;
    Subnet.findById = originals.subnetFindById;
    DiscoveryJob.create = originals.jobCreate;
    DiscoveryJob.exists = originals.jobExists;
    DiscoveryJob.updateOne = originals.jobUpdateOne;
    DiscoveryJob.findById = originals.jobFindById;
    Setting.findOne = originals.settingFindOne;
    icmpProbe.probeIcmp = originals.icmpProbe;
    neighbourService.getNeighbourTable = originals.neighborTable;
    socketService.getIO = originals.getIO;
    if (originals.discoveryAllowlist === undefined) delete process.env.DISCOVERY_ALLOWLIST;
    else process.env.DISCOVERY_ALLOWLIST = originals.discoveryAllowlist;
    if (originals.monitoringAllowlist === undefined) delete process.env.MONITORING_TARGET_ALLOWLIST;
    else process.env.MONITORING_TARGET_ALLOWLIST = originals.monitoringAllowlist;
  });
  return { subnet, createdDevices, get job() { return nextJob; } };
}

test('approved discovered devices auto-enroll as pending and cannot be monitored early', async (t) => {
  const fixture = installDiscoveryMocks(t, {
    subnetOverrides: { autoEnroll: true, requireEnrollmentApproval: true, monitoringEnabled: true },
  });
  const result = await runDiscoveryForSubnet({
    subnetId: fixture.subnet._id,
    requestedBy: 'admin-id',
    options: { resolveDns: false, checkServices: false, ports: [] },
  });

  assert.equal(fixture.createdDevices.length, 1);
  assert.equal(fixture.createdDevices[0].enrollmentStatus, 'pending');
  assert.equal(fixture.createdDevices[0].monitoringStatus, false);
  assert.equal(fixture.createdDevices[0].enrollmentSource, 'discovery');
  assert.equal(String(fixture.createdDevices[0].subnet), fixture.subnet._id);
  assert.ok(fixture.createdDevices[0].firstDiscoveredAt instanceof Date);
  assert.ok(fixture.createdDevices[0].lastDiscoveredAt instanceof Date);
  assert.equal(result.enrolledCount, 1);
  assert.equal(result.pendingApprovalCount, 1);
  assert.equal(result.devices[0].monitoringAuthorizationCode, 'ENROLLMENT_PENDING');
});

test('approved auto-enrollment enables polling only when enrollment and subnet monitoring are approved', async (t) => {
  const fixture = installDiscoveryMocks(t, {
    subnetOverrides: {
      autoEnroll: true,
      requireEnrollmentApproval: false,
      monitoringEnabled: true,
    },
  });
  const result = await runDiscoveryForSubnet({
    subnetId: fixture.subnet._id,
    requestedBy: 'admin-id',
    options: { resolveDns: false, checkServices: false, ports: [] },
  });

  assert.equal(fixture.createdDevices.length, 1);
  assert.equal(fixture.createdDevices[0].enrollmentStatus, 'approved');
  assert.equal(fixture.createdDevices[0].monitoringStatus, true);
  assert.equal(result.enrolledCount, 1);
  assert.equal(result.pendingApprovalCount, 0);
  assert.equal(result.devices[0].monitoringStatus, true);
});

test('pending subnets and empty discovery allowlists cannot start host probes', async (t) => {
  let probeCount = 0;
  const pendingFixture = installDiscoveryMocks(t, {
    subnetOverrides: { approvalStatus: 'pending' },
    probe: async () => {
      probeCount += 1;
      return { reachable: true, probeCount: 1 };
    },
  });
  await assert.rejects(
    runDiscoveryForSubnet({ subnetId: pendingFixture.subnet._id, requestedBy: 'admin-id' }),
    /Only active, administrator-approved subnets/,
  );
  assert.equal(pendingFixture.job, undefined);

  const allowlistFixture = installDiscoveryMocks(t, {
    settingOverrides: { NETWORK_AUTHORIZATION_POLICY: { mode: 'legacy_allowlists' } },
    probe: async () => {
      probeCount += 1;
      return { reachable: true, probeCount: 1 };
    },
  });
  process.env.DISCOVERY_ALLOWLIST = '';
  await assert.rejects(
    runDiscoveryForSubnet({ subnetId: allowlistFixture.subnet._id, requestedBy: 'admin-id' }),
    /exact entry in DISCOVERY_ALLOWLIST/,
  );
  assert.equal(allowlistFixture.job, undefined);
  assert.equal(probeCount, 0);
});

test('registry-only mode permits only the explicitly approved registered subnet with an empty allowlist', async (t) => {
  const fixture = installDiscoveryMocks(t, {
    settingOverrides: { DISCOVERY_AUTHORIZATION_MODE: 'subnet_registry' },
  });
  process.env.DISCOVERY_ALLOWLIST = '';
  const result = await runDiscoveryForSubnet({
    subnetId: fixture.subnet._id,
    requestedBy: 'admin-id',
    options: { resolveDns: false, checkServices: false, ports: [] },
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.subnet, fixture.subnet.cidr);
  assert.equal(result.checkedHosts, 1);
});

test('existing manually configured devices are matched instead of duplicated or overwritten', async (t) => {
  const manualDevice = {
    _id: 'manual-device',
    ipAddress: '10.88.0.1',
    macAddress: null,
    name: 'Manually configured gateway',
    vendor: 'Configured vendor',
    monitoringMethod: 'snmp',
    pollingInterval: 90,
    monitoringStatus: false,
    status: 'UNKNOWN',
    async save() {},
    toJSON() { return { _id: this._id }; },
  };
  const fixture = installDiscoveryMocks(t, {
    subnetOverrides: { autoEnroll: true },
    existingDevices: [manualDevice],
  });
  const result = await runDiscoveryForSubnet({
    subnetId: fixture.subnet._id,
    requestedBy: 'admin-id',
    options: { resolveDns: false, checkServices: false, ports: [] },
  });

  assert.equal(fixture.createdDevices.length, 0);
  assert.equal(manualDevice.name, 'Manually configured gateway');
  assert.equal(manualDevice.monitoringMethod, 'snmp');
  assert.equal(manualDevice.pollingInterval, 90);
  assert.equal(result.devices[0].isEnrolled, true);
  assert.equal(result.devices[0].deviceId, manualDevice._id);
});

test('devices with a previously enrolled MAC address are marked as duplicates', async (t) => {
  const knownDevice = {
    _id: 'known-device',
    ipAddress: '10.88.0.2',
    macAddress: '00:11:22:33:44:55',
    enrollmentStatus: 'approved',
    monitoringStatus: false,
  };
  const fixture = installDiscoveryMocks(t, {
    subnetOverrides: { autoEnroll: true },
    existingDevices: [knownDevice],
    neighborEntries: new Map([['10.88.0.1', { macAddress: knownDevice.macAddress }]]),
  });
  const result = await runDiscoveryForSubnet({
    subnetId: fixture.subnet._id,
    requestedBy: 'admin-id',
    options: { resolveDns: false, checkServices: false, ports: [] },
  });

  assert.equal(fixture.createdDevices.length, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.devices[0].isDuplicate, true);
  assert.equal(result.devices[0].duplicateDeviceId, knownDevice._id);
});

test('cancellation signals an in-progress bounded host probe and persists cancelled status', async (t) => {
  let probeStarted;
  const started = new Promise((resolve) => { probeStarted = resolve; });
  const fixture = installDiscoveryMocks(t, {
    probe: async (_ipAddress, { signal }) => new Promise((resolve) => {
      probeStarted();
      signal.addEventListener('abort', () => resolve({ reachable: false, probeCount: 0 }), { once: true });
    }),
  });
  const runPromise = runDiscoveryForSubnet({
    subnetId: fixture.subnet._id,
    requestedBy: 'admin-id',
    options: { resolveDns: false, checkServices: false, ports: [] },
  });
  await started;
  const cancellation = await cancelDiscoveryJob(fixture.job._id);
  assert.equal(cancellation.error, undefined);
  const result = await runPromise;
  assert.equal(result.status, 'cancelled');
  assert.equal(fixture.job.status, 'cancelled');
});

test('emergency stop blocks discovery before creating a job or probing a host', async (t) => {
  let probeCount = 0;
  const fixture = installDiscoveryMocks(t, {
    settingOverrides: {
      DISCOVERY_AUTHORIZATION_MODE: 'subnet_registry',
      EMERGENCY_STOP: true,
    },
    probe: async () => {
      probeCount += 1;
      return { reachable: true, probeCount: 1 };
    },
  });
  process.env.DISCOVERY_ALLOWLIST = '';

  await assert.rejects(
    runDiscoveryForSubnet({ subnetId: fixture.subnet._id, requestedBy: 'admin-id' }),
    /Emergency stop is active/,
  );
  assert.equal(fixture.job, undefined);
  assert.equal(probeCount, 0);
});
