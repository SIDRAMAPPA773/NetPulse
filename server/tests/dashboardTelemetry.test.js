const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Setting = require('../models/Setting');
const { getDashboardSummary } = require('../controllers/metricController');

async function requestDashboardSummary(t, recentMeasurement) {
  const originals = {
    countDocuments: Device.countDocuments,
    distinct: Device.distinct,
    findOne: Metric.findOne,
    aggregate: Metric.aggregate,
    settingFindOne: Setting.findOne,
  };
  let metricFilter;
  let aggregationPipeline;
  t.after(() => {
    Device.countDocuments = originals.countDocuments;
    Device.distinct = originals.distinct;
    Metric.findOne = originals.findOne;
    Metric.aggregate = originals.aggregate;
    Setting.findOne = originals.settingFindOne;
  });

  Device.countDocuments = async () => 0;
  Device.distinct = async () => ['current-device-id'];
  Metric.findOne = (filter) => {
    metricFilter = filter;
    return {
      sort() { return this; },
      select() { return this; },
      lean: async () => recentMeasurement,
    };
  };
  Metric.aggregate = async (pipeline) => {
    aggregationPipeline = pipeline;
    return [];
  };
  Setting.findOne = async () => ({ value: false });

  let body;
  await getDashboardSummary({}, {
    json(value) {
      body = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  });
  return { body, metricFilter, aggregationPipeline };
}

test('dashboard reports active real telemetry only when a valid real measurement is recent', async (t) => {
  const createdAt = new Date();
  const { body, metricFilter, aggregationPipeline } = await requestDashboardSummary(t, { createdAt });

  assert.equal(body.hasRecentRealTelemetry, true);
  assert.equal(body.latestRealMeasurementAt, createdAt);
  assert.equal(metricFilter.measurementSource, 'real');
  assert.deepEqual(metricFilter.collectionStatus, { $in: ['success', 'timeout'] });
  assert.equal(metricFilter.validity, 'valid');
  assert.deepEqual(metricFilter.device, { $in: ['current-device-id'] });
  assert.deepEqual(aggregationPipeline[0].$match.device, { $in: ['current-device-id'] });
  assert.ok(metricFilter.createdAt.$gte instanceof Date);
  assert.ok(Date.now() - metricFilter.createdAt.$gte.getTime() >= 59_000);
  assert.ok(Date.now() - metricFilter.createdAt.$gte.getTime() <= 61_000);
});

test('dashboard does not report real telemetry active when no recent valid measurement exists', async (t) => {
  const { body } = await requestDashboardSummary(t, null);

  assert.equal(body.measurementSource, 'real');
  assert.equal(body.hasRecentRealTelemetry, false);
  assert.equal(body.latestRealMeasurementAt, null);
});
