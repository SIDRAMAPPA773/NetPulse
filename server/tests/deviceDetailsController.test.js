const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Subnet = require('../models/Subnet');
const Setting = require('../models/Setting');
const { getDeviceById } = require('../controllers/deviceController');

test('device details include the latest collection and successful sample metadata', async (t) => {
  const originalFindById = Device.findById;
  const originalFindOne = Metric.findOne;
  const originalSubnetFind = Subnet.find;
  const originalSettingFindOne = Setting.findOne;
  const device = { _id: 'device-id', ipAddress: '192.168.26.6', snmpCommunity: 'private' };
  const latestCollection = {
    createdAt: new Date('2026-10-29T17:52:10.000Z'),
    collectionStatus: 'unsupported',
    reasonUnavailable: 'Target is not in MONITORING_TARGET_ALLOWLIST',
  };
  const latestSuccessfulMeasurement = {
    createdAt: new Date('2026-10-29T17:26:30.000Z'),
    measurementSource: 'simulated',
  };

  t.after(() => {
    Device.findById = originalFindById;
    Metric.findOne = originalFindOne;
    Subnet.find = originalSubnetFind;
    Setting.findOne = originalSettingFindOne;
  });

  Device.findById = () => ({
    select: async () => device,
  });
  Setting.findOne = async () => null;
  Metric.findOne = (filter) => {
    const query = {
      sort: () => query,
      select: () => query,
      lean: async () => (filter.availabilityStatus
        ? latestSuccessfulMeasurement
        : latestCollection),
    };
    Subnet.find = () => ({ lean: async () => [] });
    return query;
  };

  let responseBody;
  const response = {
    json(value) {
      responseBody = value;
      return this;
    },
  };
  await getDeviceById({ params: { id: device._id } }, response);

  assert.equal(responseBody.latestCollection, latestCollection);
  assert.equal(responseBody.latestSuccessfulMeasurement, latestSuccessfulMeasurement);
  assert.equal('snmpCommunity' in responseBody, false);
});
