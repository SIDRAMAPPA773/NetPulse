const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const monitoringEngine = require('../services/monitoringEngine');

test('telemetry test stores diagnostics but never returns SNMP secrets', async (t) => {
  const originalFindById = Device.findById;
  const originalTestDeviceTelemetry = monitoringEngine.testDeviceTelemetry;
  const device = {
    snmpAuthKey: 'private-auth-key',
    snmpPrivKey: 'private-privacy-key',
    telemetryDiagnostics: null,
    save: async () => {},
  };
  let selectedFields;

  t.after(() => {
    Device.findById = originalFindById;
    monitoringEngine.testDeviceTelemetry = originalTestDeviceTelemetry;
  });

  Device.findById = () => ({
    select: async (fields) => {
      selectedFields = fields;
      return device;
    },
  });
  monitoringEngine.testDeviceTelemetry = async () => ({
    deviceId: '507f1f77bcf86cd799439011',
    status: 'AVAILABLE',
    reason: null,
    snmpVersion: '3',
    collectedAt: new Date('2026-11-01T10:00:00.000Z'),
    collectionDurationMs: 42,
    snmp: {
      oidChecks: [{
        oid: '1.3.6.1.2.1.1.3.0',
        metricId: 'device_uptime',
        snmpVersion: '3',
        responseStatus: 'AVAILABLE',
        value: 100,
        unit: 'tim-ticks',
      }],
    },
  });
  const { testTelemetry } = require('../controllers/telemetryController');

  let responseBody;
  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };
  await testTelemetry({
    params: { id: '507f1f77bcf86cd799439011' },
  }, response);

  assert.match(selectedFields, /\+snmpAuthKey/);
  assert.match(selectedFields, /\+snmpPrivKey/);
  assert.equal(device.telemetryDiagnostics.status, 'AVAILABLE');
  assert.equal(responseBody.status, 'AVAILABLE');
  assert.equal(JSON.stringify(responseBody).includes('private-auth-key'), false);
  assert.equal(JSON.stringify(responseBody).includes('private-privacy-key'), false);
});
