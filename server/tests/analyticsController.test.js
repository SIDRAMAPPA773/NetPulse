const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const { getPerformance, getTraffic } = require('../controllers/analyticsController');

test('performance queries retain stable device identity and real measured values', async (t) => {
  const originalDeviceFind = Device.find;
  const originalMetricFind = Metric.find;
  const deviceId = '507f1f77bcf86cd799439011';
  const measurement = {
    _id: 'metric-id',
    device: deviceId,
    latency: 23.5,
    packetLoss: 0,
    measurementSource: 'real',
    collectionStatus: 'success',
    createdAt: new Date('2026-10-29T17:00:00.000Z'),
  };
  let metricFilter;

  t.after(() => {
    Device.find = originalDeviceFind;
    Metric.find = originalMetricFind;
  });

  Device.find = () => ({ select: async () => [{ _id: deviceId }] });
  Metric.find = (filter) => {
    metricFilter = filter;
    const query = {
      sort: () => query,
      limit: async () => [measurement],
    };
    return query;
  };

  let responseBody;
  const response = { json(value) { responseBody = value; return this; } };
  await getPerformance({ query: { range: '1h', device: deviceId } }, response);

  assert.deepEqual(metricFilter.device.$in, [deviceId]);
  assert.equal(responseBody[0].device, deviceId);
  assert.equal(responseBody[0].latency, 23.5);
  assert.equal(responseBody[0].packetLoss, 0);
  assert.equal(responseBody[0].collectionStatus, 'success');
  assert.equal(responseBody[0].measurementSource, 'real');
  assert.equal(responseBody[0].createdAt, measurement.createdAt);
});

test('performance returns an empty result for enrolled devices with no matching samples', async (t) => {
  const originalDeviceFind = Device.find;
  const originalMetricFind = Metric.find;

  t.after(() => {
    Device.find = originalDeviceFind;
    Metric.find = originalMetricFind;
  });

  Device.find = () => ({ select: async () => [] });
  Metric.find = () => {
    throw new Error('No metrics should be queried for a missing device filter match');
  };
  let responseBody;
  const response = { json(value) { responseBody = value; return this; } };

  await getPerformance({ query: { device: '507f1f77bcf86cd799439011' } }, response);

  assert.deepEqual(responseBody, []);
});

test('traffic analytics returns throughput grouped by device, interface, and source', async (t) => {
  const originalMetricAggregate = Metric.aggregate;
  const trafficRow = {
    _id: '507f1f77bcf86cd799439011',
    interfaceId: 'windows:Wi-Fi',
    measurementSource: 'real',
    source: 'windows-interface-counters',
    sourceProtocol: 'windows-netadapter',
    unit: 'bit/s',
    avgIncoming: 100000,
    avgOutgoing: 200000,
    sampleCount: 2,
    latestCreatedAt: new Date('2026-10-30T00:00:00.000Z'),
  };
  let pipeline;

  t.after(() => {
    Metric.aggregate = originalMetricAggregate;
  });
  Metric.aggregate = async (value) => {
    pipeline = value;
    return [trafficRow];
  };

  let responseBody;
  const response = { json(value) { responseBody = value; return this; } };
  await getTraffic({}, response);

  const match = pipeline.find(stage => stage.$match).$match;
  const groupId = pipeline.find(stage => stage.$group).$group._id;
  assert.ok(match.createdAt.$gte instanceof Date);
  assert.equal(match.metricSchemaVersion, 2);
  assert.equal(groupId.device, '$device');
  assert.equal(groupId.interfaceId, '$interfaceId');
  assert.equal(groupId.measurementSource, '$measurementSource');
  assert.equal(responseBody[0].interfaceId, 'windows:Wi-Fi');
  assert.equal(responseBody[0].source, 'windows-interface-counters');
  assert.equal(responseBody[0].avgIncoming, 100000);
  assert.equal(responseBody[0].avgOutgoing, 200000);
});

test('traffic analytics returns an empty result when no valid throughput samples exist', async (t) => {
  const originalMetricAggregate = Metric.aggregate;
  t.after(() => {
    Metric.aggregate = originalMetricAggregate;
  });
  Metric.aggregate = async () => [];

  let responseBody;
  const response = { json(value) { responseBody = value; return this; } };
  await getTraffic({}, response);

  assert.deepEqual(responseBody, []);
});
