const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const Alert = require('../models/Alert');
const socketService = require('../services/socketService');

const originalFindOne = Alert.findOne;
const originalCreate = Alert.create;
const originalFindById = Alert.findById;
const originalUpdateMany = Alert.updateMany;
const originalGetIO = socketService.getIO;

const createdAlerts = [];
const resolvedTypes = [];

Alert.findOne = async () => null;
Alert.create = async (alert) => {
  const created = { ...alert, _id: `alert-${createdAlerts.length + 1}` };
  createdAlerts.push(created);
  return created;
};
Alert.findById = () => ({
  populate: async () => null,
});
Alert.updateMany = async (filter) => {
  resolvedTypes.push(filter.type);
  return { modifiedCount: 1 };
};
socketService.getIO = () => ({ emit: () => {} });

const { processHttpAlerts } = require('../services/monitoringEngine');

after(() => {
  Alert.findOne = originalFindOne;
  Alert.create = originalCreate;
  Alert.findById = originalFindById;
  Alert.updateMany = originalUpdateMany;
  socketService.getIO = originalGetIO;
});

test('creates endpoint failure and TLS expiry alerts for approved HTTP results', async () => {
  await processHttpAlerts(
    { _id: 'device-1', name: 'Gateway', ipAddress: '192.168.1.1' },
    [{
      targetUrl: 'https://192.168.1.1/health',
      status: 'TIMEOUT',
      available: false,
      error: 'HTTP request timed out',
      tls: null,
    }, {
      targetUrl: 'https://192.168.1.1/status',
      status: 'RESPONDED',
      available: true,
      tls: { remainingValidityDays: 5 },
    }],
  );

  assert.deepEqual(
    createdAlerts.map((alert) => [alert.type, alert.severity]),
    [
      ['HTTP_ENDPOINT_FAILURE:https://192.168.1.1/health', 'HIGH'],
      ['TLS_CERTIFICATE_EXPIRING:https://192.168.1.1/status', 'CRITICAL'],
    ],
  );
});

test('resolves endpoint and certificate alerts after healthy results', async () => {
  createdAlerts.length = 0;
  resolvedTypes.length = 0;

  await processHttpAlerts(
    { _id: 'device-1', name: 'Gateway', ipAddress: '192.168.1.1' },
    [{
      targetUrl: 'https://192.168.1.1/health',
      status: 'RESPONDED',
      available: true,
      tls: { remainingValidityDays: 90 },
    }],
  );

  assert.deepEqual(resolvedTypes, [
    'HTTP_ENDPOINT_FAILURE:https://192.168.1.1/health',
    'TLS_CERTIFICATE_EXPIRING:https://192.168.1.1/health',
  ]);
});
