const test = require('node:test');
const assert = require('node:assert/strict');
const snmp = require('net-snmp');
const Setting = require('../models/Setting');
const {
  HARDWARE_OIDS,
} = require('../utils/snmpHardwareCollectors');
const {
  classifySnmpError,
  collectSnmp,
  testDeviceTelemetry,
} = require('../services/monitoringEngine');
const { setEmergencyStop } = require('../utils/networkSafety');

test('SNMP errors are classified without returning raw credential-bearing messages', () => {
  assert.equal(classifySnmpError(new Error('Request timed out')), 'TIMEOUT');
  assert.equal(classifySnmpError(new Error('USM authentication failure')), 'AUTHENTICATION_FAILED');
  assert.equal(classifySnmpError(new Error('NoSuchName')), 'UNSUPPORTED');
  assert.equal(classifySnmpError(new Error('socket failure')), 'COLLECTION_ERROR');
});

test('SNMP collection measures supported uptime, CPU, and physical memory and discovers sensor support', async (t) => {
  const originalCreateSession = snmp.createSession;
  let closed = false;
  const session = {
    get(oids, callback) {
      callback(null, oids.map((oid) => ({
        oid,
        value: oid === HARDWARE_OIDS.sysUpTime ? 123_400
          : oid === HARDWARE_OIDS.ucdCpuIdle ? 30
            : oid === HARDWARE_OIDS.ucdMemTotalReal ? 1_000_000
              : oid === HARDWARE_OIDS.ucdMemAvailReal ? 250_000
                : oid === HARDWARE_OIDS.sysDescr ? 'Test host'
                  : 0,
      })));
    },
    subtree(oid, repetitions, feed, done) {
      const rows = oid === HARDWARE_OIDS.hrProcessorLoadTable
        ? [{ oid: `${oid}.1`, value: 20 }, { oid: `${oid}.2`, value: 40 }]
        : oid === '1.3.6.1.2.1.25.2.3.1'
          ? [
            { oid: `${HARDWARE_OIDS.hrStorageTypeTable}.8`, value: HARDWARE_OIDS.hrStorageRam },
            { oid: `${HARDWARE_OIDS.hrStorageAllocationUnitsTable}.8`, value: 1024 },
            { oid: `${HARDWARE_OIDS.hrStorageSizeTable}.8`, value: 1000 },
            { oid: `${HARDWARE_OIDS.hrStorageUsedTable}.8`, value: 800 },
          ]
          : [];
      if (rows.length) feed(rows);
      done(null);
    },
    close() {
      closed = true;
    },
  };
  t.after(() => {
    snmp.createSession = originalCreateSession;
  });
  snmp.createSession = () => session;

  const result = await collectSnmp({
    _id: 'device-snmp-telemetry',
    ipAddress: '10.77.0.10',
    snmpVersion: '2c',
    snmpCommunity: 'test-read-only',
  });

  assert.equal(result.responded, true);
  assert.equal(result.sysUpTime, 123_400);
  assert.equal(result.hardware.cpu.utilization, 70);
  assert.equal(result.hardware.cpu.source, 'ucd-snmp');
  assert.equal(result.hardware.memory.utilization, 75);
  assert.equal(result.hardware.memory.source, 'ucd-snmp');
  assert.equal(result.hardware.temperature.celsius, null);
  assert.ok(result.oidChecks.some(check => check.metricId === 'temperature' && check.responseStatus === 'UNSUPPORTED'));
  assert.ok(result.oidChecks.every(check => check.deviceId === 'device-snmp-telemetry'));
  assert.equal(closed, true);
  assert.equal(JSON.stringify(result).includes('test-read-only'), false);
});

test('telemetry diagnostics refuse simulated or unapproved devices before creating an SNMP session', async (t) => {
  const originalFindOne = Setting.findOne;
  const originalCreateSession = snmp.createSession;
  const originalAllowlist = process.env.MONITORING_TARGET_ALLOWLIST;
  let sessionCreated = false;

  t.after(() => {
    Setting.findOne = originalFindOne;
    snmp.createSession = originalCreateSession;
    if (originalAllowlist === undefined) delete process.env.MONITORING_TARGET_ALLOWLIST;
    else process.env.MONITORING_TARGET_ALLOWLIST = originalAllowlist;
    setEmergencyStop(false);
  });

  process.env.MONITORING_TARGET_ALLOWLIST = '';
  setEmergencyStop(false);
  Setting.findOne = async ({ key }) => ({
    value: key === 'SIMULATION_MODE' ? true : false,
  });
  snmp.createSession = () => {
    sessionCreated = true;
    throw new Error('Must not create a session');
  };

  const result = await testDeviceTelemetry({
    _id: 'device-simulated',
    ipAddress: '10.77.0.11',
    monitoringMethod: 'snmp',
  });
  assert.equal(result.errorCode, 'SIMULATION_MODE');
  assert.equal(sessionCreated, false);
});
