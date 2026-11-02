const test = require('node:test');
const assert = require('node:assert/strict');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const socketService = require('../services/socketService');
const icmpProbe = require('../utils/icmpProbe');
const snmp = require('net-snmp');

test('SNMP hardware timeout leaves a device reachable by ICMP online', async (t) => {
  const originals = {
    metricCreate: Metric.create,
    alertFindOne: Alert.findOne,
    alertCreate: Alert.create,
    alertUpdateMany: Alert.updateMany,
    settingFind: Setting.find,
    subnetFind: Subnet.find,
    socketGetIO: socketService.getIO,
    icmpProbe: icmpProbe.probeIcmp,
    snmpCreateSession: snmp.createSession,
    allowlist: process.env.MONITORING_TARGET_ALLOWLIST,
  };
  let savedMetric;
  t.after(() => {
    Metric.create = originals.metricCreate;
    Alert.findOne = originals.alertFindOne;
    Alert.create = originals.alertCreate;
    Alert.updateMany = originals.alertUpdateMany;
    Setting.find = originals.settingFind;
    Subnet.find = originals.subnetFind;
    socketService.getIO = originals.socketGetIO;
    icmpProbe.probeIcmp = originals.icmpProbe;
    snmp.createSession = originals.snmpCreateSession;
    if (originals.allowlist === undefined) delete process.env.MONITORING_TARGET_ALLOWLIST;
    else process.env.MONITORING_TARGET_ALLOWLIST = originals.allowlist;
  });

  process.env.MONITORING_TARGET_ALLOWLIST = '10.77.0.12';
  Metric.create = async (metric) => {
    savedMetric = metric;
    return { ...metric, createdAt: new Date() };
  };
  Alert.findOne = async () => null;
  Alert.create = async (alert) => alert;
  Alert.updateMany = async () => ({ modifiedCount: 0 });
  Setting.find = async () => [
    { key: 'SIMULATION_MODE', value: false },
    { key: 'EMERGENCY_STOP', value: false },
  ];
  Subnet.find = () => ({
    lean: async () => [{
      _id: 'subnet-hardware-test',
      cidr: '10.77.0.0/24',
      status: 'active',
      approvalStatus: 'approved',
      monitoringEnabled: true,
    }],
  });
  socketService.getIO = () => ({ emit() {} });
  icmpProbe.probeIcmp = async () => ({
    reachable: true,
    rttAvg: 12,
    rttMin: 11,
    rttMax: 13,
    rttStddev: 1,
    packetLoss: 0,
    availability: 100,
    probeCount: 1,
    probes: [{ success: true, rttMs: 12 }],
  });
  snmp.createSession = () => ({
    get(oids, callback) {
      callback(new Error('Request timed out'));
    },
    close() {},
  });

  const { processDevice, updateSettingsCache } = require('../services/monitoringEngine');
  await updateSettingsCache();
  const device = {
    _id: 'device-hardware-timeout',
    name: 'Reachable switch',
    ipAddress: '10.77.0.12',
    monitoringMethod: 'snmp',
    snmpVersion: '2c',
    snmpCommunity: 'readonly',
    status: 'UNKNOWN',
    async save() {},
    toJSON() {
      return { _id: this._id, status: this.status };
    },
  };
  await processDevice(device, { acquire: async () => {} });

  assert.equal(device.status, 'UP');
  assert.equal(savedMetric.status, 'UP');
  assert.equal(savedMetric.snmp.errorCode, 'TIMEOUT');
  assert.equal(savedMetric.cpuUtilization, null);
  assert.equal(savedMetric.memoryUtilization, null);
  assert.equal(savedMetric.hardware.availability.cpu, 'TIMEOUT');
});
