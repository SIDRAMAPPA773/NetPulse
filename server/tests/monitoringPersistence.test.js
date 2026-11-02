const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const socketService = require('../services/socketService');
const icmpProbe = require('../utils/icmpProbe');
const snmp = require('net-snmp');

const originalMetricCreate = Metric.create;
const originalAlertUpdateMany = Alert.updateMany;
const originalAlertFindOne = Alert.findOne;
const originalAlertCreate = Alert.create;
const originalAlertFindById = Alert.findById;
const originalSettingFind = Setting.find;
const originalSubnetFind = Subnet.find;
const originalGetIO = socketService.getIO;
const originalProbeIcmp = icmpProbe.probeIcmp;
const originalCreateSnmpSession = snmp.createSession;
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
  Subnet.find = originalSubnetFind;
  socketService.getIO = originalGetIO;
  icmpProbe.probeIcmp = originalProbeIcmp;
  snmp.createSession = originalCreateSnmpSession;
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
Subnet.find = () => ({
  lean: async () => [{
    _id: 'subnet-test',
    cidr: '10.38.27.0/24',
    status: 'active',
    approvalStatus: 'approved',
    monitoringEnabled: true,
  }],
});
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

  const saved = persistedMetrics.filter((metric) => metric.device === device._id).at(-1);
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
  assert.equal(saved.health.availabilityScore, 100);
  assert.equal(saved.health.performanceScore, 95);
  assert.equal(saved.health.coveragePercent, 70);
  assert.equal(saved.health.overallScore, 70);
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
  assert.equal(saved.reasonUnavailable, 'Device is outside MONITORING_TARGET_ALLOWLIST; add its approved subnet CIDR during migration');
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

test('completed unanswered ICMP probes require repeated failures before reporting down', async () => {
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
  assert.equal(device.status, 'UNKNOWN');
  await processDevice(device, { acquire: async () => {} });
  assert.equal(device.status, 'UNKNOWN');
  await processDevice(device, { acquire: async () => {} });

  const saved = persistedMetrics.at(-1);
  assert.equal(device.status, 'DOWN');
  assert.equal(saved.collectionStatus, 'success');
  assert.equal(saved.availabilityStatus, 'available');
  assert.equal(saved.packetLoss, 100);
});

test('a configured SNMP response confirms reachability when ICMP is blocked', async () => {
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
  snmp.createSession = () => ({
    get: (oids, callback) => callback(null, [{
      oid: '1.3.6.1.2.1.1.3.0',
      value: 12345,
    }]),
    close: () => {},
  });
  const device = {
    _id: 'device-snmp-only',
    name: 'SNMP-only device',
    ipAddress: '10.38.27.191',
    status: 'UNKNOWN',
    monitoringMethod: 'snmp',
    snmpCommunity: 'test-community',
    snmpVersion: '2c',
    save: async () => {},
    toJSON() {
      return { _id: this._id, ipAddress: this.ipAddress, status: this.status };
    },
  };

  await processDevice(device, { acquire: async () => {} });

  const saved = persistedMetrics.at(-1);
  assert.equal(device.status, 'WARNING');
  assert.equal(saved.status, 'WARNING');
  assert.equal(saved.snmp.sysUpTime, 12345);
  assert.equal(saved.snmp.responded, true);
  assert.equal(saved.availabilityStatus, 'available');
  assert.equal(saved.latency, null);
  assert.equal(saved.packetLoss, 100);
});

test('SNMPv2 prefers exact high-capacity counters for rollover-safe interface rates', async () => {
  process.env.MONITORING_TARGET_ALLOWLIST = '10.38.27.191';
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
  let sampleIndex = 0;
  let requestedOids = [];
  snmp.createSession = () => ({
    get: (oids, callback) => {
      requestedOids = oids;
      const sample = sampleIndex;
      sampleIndex += 1;
      const counters = sample === 0
        ? { in: 18446744073709551600n, out: 18446744073709551600n, packets: 1000n }
        : { in: 10n, out: 10n, packets: 1020n };
      callback(null, oids.map((oid) => {
        const suffix = oid.slice(oid.lastIndexOf('.') + 1);
        if (oid === '1.3.6.1.2.1.1.3.0') return { oid, value: 1000 };
        if (oid === '1.3.6.1.2.1.2.2.1.2.2') return { oid, value: 'eth0' };
        if (oid === `1.3.6.1.2.1.31.1.1.1.6.2`) return { oid, value: counters.in };
        if (oid === `1.3.6.1.2.1.31.1.1.1.10.2`) return { oid, value: counters.out };
        if (oid === `1.3.6.1.2.1.31.1.1.1.7.2`) return { oid, value: counters.packets };
        if (oid === `1.3.6.1.2.1.31.1.1.1.11.2`) return { oid, value: counters.packets };
        if (['14', '20', '13', '19', '5', '8'].includes(oid.split('.')[10])) {
          return { oid, value: Number(suffix) + 1 };
        }
        return { oid, value: 0 };
      }));
    },
    close: () => {},
  });
  const device = {
    _id: 'device-hc-counters',
    name: 'High capacity switch',
    ipAddress: '10.38.27.191',
    status: 'UNKNOWN',
    monitoringMethod: 'snmp',
    snmpCommunity: 'test-community',
    snmpVersion: '2c',
    snmpInterfaceIndex: 2,
    save: async () => {},
    toJSON() {
      return { _id: this._id, ipAddress: this.ipAddress, status: this.status };
    },
  };

  await processDevice(device, { acquire: async () => {} });
  await new Promise(resolve => setTimeout(resolve, 5));
  await processDevice(device, { acquire: async () => {} });

  const saved = persistedMetrics.filter((metric) => metric.device === device._id).at(-1);
  assert.ok(requestedOids.includes('1.3.6.1.2.1.31.1.1.1.6.2'));
  assert.equal(saved.snmp.inOctetsHC, '10');
  assert.equal(saved.snmp.outOctetsHC, '10');
  assert.ok(saved.snmp.inBps > 0);
  assert.ok(saved.snmp.outBps > 0);
});
