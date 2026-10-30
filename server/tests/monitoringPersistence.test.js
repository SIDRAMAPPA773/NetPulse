const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const Setting = require('../models/Setting');
const socketService = require('../services/socketService');
const icmpProbe = require('../utils/icmpProbe');

const originalMetricCreate = Metric.create;
const originalAlertUpdateMany = Alert.updateMany;
const originalAlertFindOne = Alert.findOne;
const originalAlertCreate = Alert.create;
const originalAlertFindById = Alert.findById;
const originalSettingFind = Setting.find;
const originalGetIO = socketService.getIO;
const originalProbeIcmp = icmpProbe.probeIcmp;
const originalAllowlist = process.env.MONITORING_TARGET_ALLOWLIST;
const emissions = [];
const persistedMetrics = [];
let probeCount = 0;
let nextProbeResult = {
  reachable: true,
  rttAvg: 23.5,
  rttMin: 20,
  rttMax: 27,
  rttStddev: 2,
  packetLoss: 0,
  availability: 100,
  probeCount: 2,
  probes: [
    { success: true, rttMs: 20 },
    { success: true, rttMs: 27 },
  ],
};
let alertUpdateCount = 0;

after(() => {
  Metric.create = originalMetricCreate;
  Alert.updateMany = originalAlertUpdateMany;
  Alert.findOne = originalAlertFindOne;
  Alert.create = originalAlertCreate;
  Alert.findById = originalAlertFindById;
  Setting.find = originalSettingFind;
  socketService.getIO = originalGetIO;
  icmpProbe.probeIcmp = originalProbeIcmp;
  if (originalAllowlist === undefined) delete process.env.MONITORING_TARGET_ALLOWLIST;
  else process.env.MONITORING_TARGET_ALLOWLIST = originalAllowlist;
});

Metric.create = async (document) => {
  const metric = { ...document, _id: `metric-${persistedMetrics.length + 1}`, createdAt: new Date() };
  persistedMetrics.push(metric);
  return metric;
};
Alert.updateMany = async () => {
  alertUpdateCount += 1;
  return { modifiedCount: 0 };
};
Setting.find = async () => [
  { key: 'SIMULATION_MODE', value: false },
  { key: 'EMERGENCY_STOP', value: false },
];
socketService.getIO = () => ({ emit: (...args) => emissions.push(args) });
icmpProbe.probeIcmp = async () => {
  probeCount += 1;
  return nextProbeResult;
};

const { processDevice, updateSettingsCache } = require('../services/monitoringEngine');

test('real authorized ICMP results are persisted with measured values and timestamps', async () => {
  process.env.MONITORING_TARGET_ALLOWLIST = '10.38.27.142,10.38.27.191';
  await updateSettingsCache();
  const device = {
    _id: 'device-142',
    name: 'Gateway',
    ipAddress: '10.38.27.142',
    status: 'UNKNOWN',
    monitoringMethod: 'icmp',
    save: async () => {},
    toJSON() {
      return { _id: this._id, ipAddress: this.ipAddress, status: this.status };
    },
  };

  await processDevice(device, { acquire: async () => {} });

  const saved = persistedMetrics.at(-1);
  assert.equal(probeCount, 1);
  assert.equal(saved.device, device._id);
  assert.equal(saved.status, 'UP');
  assert.equal(saved.measurementSource, 'real');
  assert.equal(saved.monitoringMode, 'real');
  assert.equal(saved.collectionStatus, 'success');
  assert.equal(saved.availabilityStatus, 'available');
  assert.equal(saved.latency, 23.5);
  assert.equal(saved.packetLoss, 0);
  assert.equal(saved.availability, 100);
  assert.equal(saved.jitter, 7);
  assert.equal(saved.sampleCount, 2);
  assert.equal(saved.raw.probes.length, 2);
  assert.ok(saved.observationWindowStart instanceof Date);
  assert.ok(saved.observationWindowEnd instanceof Date);
});

test('local Windows interface byte deltas are persisted as real interface throughput', async () => {
  process.env.MONITORING_TARGET_ALLOWLIST = '10.38.27.142,10.38.27.191';
  await updateSettingsCache();
  nextProbeResult = {
    reachable: true,
    rttAvg: 10,
    rttMin: 10,
    rttMax: 10,
    rttStddev: 0,
    packetLoss: 0,
    availability: 100,
    probeCount: 1,
    probes: [{ success: true, rttMs: 10 }],
  };
  const device = {
    _id: 'device-local-throughput',
    name: 'Local laptop',
    ipAddress: '10.38.27.191',
    status: 'UNKNOWN',
    monitoringMethod: 'icmp',
    save: async () => {},
    toJSON() {
      return { _id: this._id, ipAddress: this.ipAddress, status: this.status };
    },
  };
  const firstSnapshot = {
    observedAt: 1000,
    interfaces: [{
      interfaceName: 'Wi-Fi',
      ipAddresses: ['10.38.27.191'],
      receivedBytes: '1000000',
      sentBytes: '2000000',
    }],
  };
  const secondSnapshot = {
    observedAt: 11000,
    interfaces: [{
      interfaceName: 'Wi-Fi',
      ipAddresses: ['10.38.27.191'],
      receivedBytes: '1125000',
      sentBytes: '2250000',
    }],
  };

  await processDevice(device, { acquire: async () => {} }, firstSnapshot);
  const baseline = persistedMetrics.at(-1);
  assert.equal(baseline.incomingThroughputBps, null);
  assert.match(baseline.derived.unavailableMetrics.inboundThroughput, /second/i);

  await processDevice(device, { acquire: async () => {} }, secondSnapshot);
  const saved = persistedMetrics.at(-1);
  assert.equal(saved.device, device._id);
  assert.equal(saved.interfaceId, 'windows:Wi-Fi');
  assert.equal(saved.incomingThroughputBps, 100000);
  assert.equal(saved.outgoingThroughputBps, 200000);
  assert.equal(saved.source, 'windows-interface-counters');
  assert.equal(saved.sourceProtocol, 'windows-netadapter');
  assert.equal(saved.unit, 'bit/s');
  assert.equal(saved.metadata.interfaceName, 'Wi-Fi');
  assert.equal(saved.metadata.localIpAddress, '10.38.27.191');
  assert.equal(saved.metadata.elapsedSeconds, 10);
  assert.equal(saved.measurementSource, 'real');
});

test('unauthorized devices persist a reason without attempting ICMP', async () => {
  process.env.MONITORING_TARGET_ALLOWLIST = '';
  await updateSettingsCache();
  const previousProbeCount = probeCount;
  const device = {
    _id: 'device-191',
    ipAddress: '10.38.27.191',
    status: 'UNKNOWN',
    monitoringMethod: 'icmp',
    save: async () => {},
    toJSON() {
      return { _id: this._id, ipAddress: this.ipAddress, status: this.status };
    },
  };

  await processDevice(device, { acquire: async () => {} });

  const saved = persistedMetrics.at(-1);
  assert.equal(probeCount, previousProbeCount);
  assert.equal(saved.collectionStatus, 'blocked');
  assert.equal(saved.availabilityStatus, 'unavailable');
  assert.equal(saved.reasonUnavailable, 'Target is not in MONITORING_TARGET_ALLOWLIST');
  assert.equal(saved.latency, undefined);
  assert.equal(saved.packetLoss, undefined);
});

test('ICMP collector execution errors remain UNKNOWN and do not become false packet loss or recovery', async () => {
  process.env.MONITORING_TARGET_ALLOWLIST = '10.38.27.142,10.38.27.191';
  await updateSettingsCache();
  nextProbeResult = {
    reachable: false,
    rttAvg: null,
    rttMin: null,
    rttMax: null,
    rttStddev: null,
    packetLoss: 100,
    availability: 0,
    probeCount: 5,
    probes: Array.from({ length: 5 }, () => ({ success: false, rttMs: null })),
    error: 'ICMP process execution failed',
  };
  const previousAlertUpdateCount = alertUpdateCount;
  const device = {
    _id: 'device-191-error',
    name: 'Workstation',
    ipAddress: '10.38.27.191',
    status: 'UNKNOWN',
    monitoringMethod: 'icmp',
    save: async () => {},
    toJSON() {
      return { _id: this._id, ipAddress: this.ipAddress, status: this.status };
    },
  };

  await processDevice(device, { acquire: async () => {} });

  const saved = persistedMetrics.at(-1);
  assert.equal(device.status, 'UNKNOWN');
  assert.equal(saved.status, 'UNKNOWN');
  assert.equal(saved.collectionStatus, 'error');
  assert.equal(saved.validity, 'unknown');
  assert.equal(saved.packetLoss, null);
  assert.equal(saved.availability, null);
  assert.equal(saved.reasonUnavailable, 'One or more ICMP probes failed to execute');
  assert.equal(alertUpdateCount, previousAlertUpdateCount);
});

test('completed unanswered ICMP probes still report unreachable status', async () => {
  Alert.findOne = async () => null;
  Alert.create = async (alert) => ({ ...alert, _id: 'test-alert-id' });
  Alert.findById = () => ({
    populate: async () => ({ _id: 'test-alert-id' }),
  });
  process.env.MONITORING_TARGET_ALLOWLIST = '10.38.27.191';
  await updateSettingsCache();
  nextProbeResult = {
    reachable: false,
    rttAvg: null,
    rttMin: null,
    rttMax: null,
    rttStddev: null,
    packetLoss: 100,
    availability: 0,
    probeCount: 5,
    probes: Array.from({ length: 5 }, () => ({ success: false, rttMs: null })),
    error: null,
  };
  const device = {
    _id: 'device-191-timeout',
    name: 'Workstation',
    ipAddress: '10.38.27.191',
    status: 'UNKNOWN',
    monitoringMethod: 'icmp',
    save: async () => {},
    toJSON() {
      return { _id: this._id, ipAddress: this.ipAddress, status: this.status };
    },
  };

  await processDevice(device, { acquire: async () => {} });

  const saved = persistedMetrics.at(-1);
  assert.equal(device.status, 'DOWN');
  assert.equal(saved.collectionStatus, 'success');
  assert.equal(saved.availabilityStatus, 'available');
  assert.equal(saved.packetLoss, 100);
});
