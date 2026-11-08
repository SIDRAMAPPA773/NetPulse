const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { processDeviceAnomalies, computeFleetAnalytics } = require('../services/anomalyDetectionService');
const Alert = require('../models/Alert');

test('processDeviceAnomalies detects sudden latency spikes and dedupes active alerts', async () => {
  const originalFind = Alert.find;
  const originalCreate = Alert.create;

  const alerts = [];
  Alert.find = async () => [];
  Alert.create = async (data) => {
    alerts.push(data);
    return { ...data, save: async () => {} };
  };

  const device = {
    _id: new mongoose.Types.ObjectId(),
    ipAddress: '10.38.27.15',
    name: 'Edge Router',
  };

  const currentMetric = {
    latency: 280, // critical latency
    rttMin: 250,
    rttMax: 310,
    packetLoss: 0,
    jitter: 10,
  };

  const pastMetrics = [
    { latency: 25 },
    { latency: 30 },
    { latency: 28 },
  ];

  try {
    const anomalies = await processDeviceAnomalies({
      device,
      currentMetric,
      previousMetrics: pastMetrics,
      thresholds: { LATENCY_WARNING: 100, LATENCY_CRITICAL: 250 },
    });

    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0].type, 'SUDDEN_LATENCY_SPIKE');
    assert.equal(anomalies[0].severity, 'CRITICAL');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'SUDDEN_LATENCY_SPIKE');
  } finally {
    Alert.find = originalFind;
    Alert.create = originalCreate;
  }
});

test('computeFleetAnalytics correctly distinguishes observed from authorized devices without combining online counts', () => {
  const devices = [
    {
      _id: '1',
      name: 'Campus Gateway',
      ipAddress: '10.0.0.1',
      type: 'gateway',
      status: 'UP',
      monitoringTier: 'authorized',
      isPassiveOnly: false,
      latestMetric: { latency: 5, packetLoss: 0 },
    },
    {
      _id: '2',
      name: 'Core Switch',
      ipAddress: '10.0.0.2',
      type: 'switch',
      status: 'DOWN',
      monitoringTier: 'authorized',
      isPassiveOnly: false,
      latestMetric: { latency: null, packetLoss: 100 },
    },
    {
      _id: '3',
      name: 'Host-10.0.0.99',
      ipAddress: '10.0.0.99',
      type: 'unknown',
      status: 'UNKNOWN', // Observed only!
      monitoringTier: 'observed',
      isPassiveOnly: true,
    },
  ];

  const recentMetrics = [
    { latency: 5, packetLoss: 0, jitter: 1 },
  ];

  const fleet = computeFleetAnalytics(devices, recentMetrics);

  assert.equal(fleet.totalAuthorizedMonitoredIps, 2);
  assert.equal(fleet.totalObservedIps, 1);
  assert.equal(fleet.verifiedOnline, 1);
  assert.equal(fleet.verifiedOffline, 1);
  assert.equal(fleet.unknownStatus, 1);
  assert.equal(fleet.avgFleetLatency, 5);
  assert.equal(fleet.highestLatencyDevices[0].ipAddress, '10.0.0.1');
});
