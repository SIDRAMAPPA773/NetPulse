const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const { getDevices } = require('../controllers/deviceController');

test('device inventory includes enabled devices with no recent measurements', async (t) => {
  const originalDeviceFind = Device.find;
  const originalMetricAggregate = Metric.aggregate;
  const originalAlertAggregate = Alert.aggregate;
  const device = {
    _id: 'device-id',
    ipAddress: '10.38.27.142',
    name: 'Gateway',
    monitoringStatus: true,
    toObject() {
      return { _id: this._id, ipAddress: this.ipAddress, name: this.name, monitoringStatus: this.monitoringStatus };
    },
  };

  t.after(() => {
    Device.find = originalDeviceFind;
    Metric.aggregate = originalMetricAggregate;
    Alert.aggregate = originalAlertAggregate;
  });

  const query = {
    select: () => query,
    sort: () => query,
    limit: async () => [device],
  };
  Device.find = () => query;
  Metric.aggregate = async () => [];
  Alert.aggregate = async () => [];

  let responseBody;
  const response = { json(value) { responseBody = value; return this; } };
  await getDevices({}, response);

  assert.equal(responseBody.length, 1);
  assert.equal(responseBody[0]._id, 'device-id');
  assert.equal(responseBody[0].monitoringStatus, true);
  assert.equal(responseBody[0].collectionStatus, 'no_measurements');
  assert.equal(responseBody[0].collectionReason, 'No measurements recorded in the last 7 days');
  assert.equal(responseBody[0].latestMetric, null);
  assert.equal(responseBody[0].latestSuccessfulMeasurement, null);
});

test('device inventory separates an authorization-blocked collection from the last successful measurement', async (t) => {
  const originalDeviceFind = Device.find;
  const originalMetricAggregate = Metric.aggregate;
  const originalAlertAggregate = Alert.aggregate;
  const successfulMeasurement = {
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    measurementSource: 'simulated',
    monitoringMode: 'simulation',
  };
  const device = {
    _id: 'device-id',
    ipAddress: '10.38.27.142',
    name: 'Gateway',
    monitoringStatus: true,
    toObject() {
      return { _id: this._id, ipAddress: this.ipAddress, name: this.name, monitoringStatus: this.monitoringStatus };
    },
  };

  t.after(() => {
    Device.find = originalDeviceFind;
    Metric.aggregate = originalMetricAggregate;
    Alert.aggregate = originalAlertAggregate;
  });

  const query = {
    select: () => query,
    sort: () => query,
    limit: async () => [device],
  };
  Device.find = () => query;
  Metric.aggregate = async (pipeline) => {
    const match = pipeline.find((stage) => stage.$match);
    if (match.$match.availabilityStatus === 'available') {
      return [{ _id: device._id, latestSuccessfulMeasurement: successfulMeasurement }];
    }
    return [{
      _id: device._id,
      latestMetric: {
        collectionStatus: 'blocked',
        reasonUnavailable: 'Target is not in MONITORING_TARGET_ALLOWLIST',
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
      },
    }];
  };
  Alert.aggregate = async () => [];

  let responseBody;
  const response = { json(value) { responseBody = value; return this; } };
  await getDevices({}, response);

  assert.equal(responseBody[0].collectionStatus, 'blocked');
  assert.equal(responseBody[0].collectionReason, 'Target is not in MONITORING_TARGET_ALLOWLIST');
  assert.deepEqual(responseBody[0].latestSuccessfulMeasurement, successfulMeasurement);
});
