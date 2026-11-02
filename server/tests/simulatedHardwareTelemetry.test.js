const test = require('node:test');
const assert = require('node:assert/strict');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const Setting = require('../models/Setting');
const socketService = require('../services/socketService');
const snmp = require('net-snmp');

test('simulation samples are explicitly tagged and never initiate SNMP collection', async (t) => {
  const originals = {
    metricCreate: Metric.create,
    alertFindOne: Alert.findOne,
    alertCreate: Alert.create,
    alertUpdateMany: Alert.updateMany,
    settingFind: Setting.find,
    socketGetIO: socketService.getIO,
    snmpCreateSession: snmp.createSession,
    random: Math.random,
  };
  let savedMetric;
  let sessionCreated = false;
  t.after(() => {
    Metric.create = originals.metricCreate;
    Alert.findOne = originals.alertFindOne;
    Alert.create = originals.alertCreate;
    Alert.updateMany = originals.alertUpdateMany;
    Setting.find = originals.settingFind;
    socketService.getIO = originals.socketGetIO;
    snmp.createSession = originals.snmpCreateSession;
    Math.random = originals.random;
  });

  Metric.create = async (metric) => {
    savedMetric = metric;
    return { ...metric, createdAt: new Date() };
  };
  Alert.findOne = async () => null;
  Alert.create = async (alert) => alert;
  Alert.updateMany = async () => ({ modifiedCount: 0 });
  Setting.find = async () => [
    { key: 'SIMULATION_MODE', value: true },
    { key: 'EMERGENCY_STOP', value: false },
  ];
  socketService.getIO = () => ({ emit() {} });
  snmp.createSession = () => {
    sessionCreated = true;
    throw new Error('Simulation must not open SNMP sessions');
  };
  Math.random = () => 0.5;

  const { processDevice, updateSettingsCache } = require('../services/monitoringEngine');
  await updateSettingsCache();
  const device = {
    _id: 'device-simulated-telemetry',
    name: 'Simulated device',
    ipAddress: '192.0.2.10',
    monitoringMethod: 'snmp',
    status: 'UNKNOWN',
    async save() {},
    toJSON() {
      return { _id: this._id, status: this.status };
    },
  };
  await processDevice(device, { acquire: async () => {} });

  assert.equal(savedMetric.measurementSource, 'simulated');
  assert.equal(savedMetric.hardware.cpu.source, 'simulation');
  assert.equal(savedMetric.hardware.availability.cpu, 'SIMULATED');
  assert.equal(savedMetric.hardware.temperature.celsius, null);
  assert.equal(savedMetric.hardware.availability.temperature, 'UNSUPPORTED');
  assert.equal(sessionCreated, false);
});
