const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HARDWARE_OIDS,
  discoverSnmpInterfaces,
  parseHardwareVarbinds,
} = require('../utils/snmpHardwareCollectors');

test('parseHardwareVarbinds parses UCD-SNMP CPU and memory metrics', () => {
  const varbinds = [
    { oid: HARDWARE_OIDS.sysDescr, value: 'Linux campus-core 5.15' },
    { oid: HARDWARE_OIDS.sysUpTime, value: 500000 },
    { oid: HARDWARE_OIDS.sysName, value: 'campus-core' },
    { oid: HARDWARE_OIDS.ucdCpuIdle, value: 35 },
    { oid: HARDWARE_OIDS.ucdMemTotalReal, value: 16000000 }, // in kB
    { oid: HARDWARE_OIDS.ucdMemAvailReal, value: 4000000 },
  ];

  const result = parseHardwareVarbinds(varbinds);
  assert.equal(result.system.sysDescr, 'Linux campus-core 5.15');
  assert.equal(result.system.sysUpTime, 500000);
  assert.equal(result.system.sysName, 'campus-core');
  assert.equal(result.cpu.utilization, 65); // 100 - 35
  assert.equal(result.cpu.source, 'ucd-snmp');
  assert.equal(result.cpu.reason, null);

  assert.equal(result.memory.totalBytes, 16000000 * 1024);
  assert.equal(result.memory.freeBytes, 4000000 * 1024);
  assert.equal(result.memory.usedBytes, 12000000 * 1024);
  assert.equal(result.memory.utilization, 75);
  assert.equal(result.memory.source, 'ucd-snmp');
  assert.equal(result.memory.reason, null);
});

test('parseHardwareVarbinds parses Cisco CPU, memory, and temperature sensors', () => {
  const varbinds = [
    { oid: HARDWARE_OIDS.ciscoCpu5Min, value: 42 },
    { oid: HARDWARE_OIDS.ciscoMemUsed, value: 50000000 },
    { oid: HARDWARE_OIDS.ciscoMemFree, value: 50000000 },
    { oid: HARDWARE_OIDS.ciscoEnvMonTemp, value: 38 },
    { oid: HARDWARE_OIDS.ciscoEnvMonThreshold, value: 65 },
  ];

  const result = parseHardwareVarbinds(varbinds);
  assert.equal(result.cpu.utilization, 42);
  assert.equal(result.cpu.source, 'cisco-cpm');

  assert.equal(result.memory.utilization, 50);
  assert.equal(result.memory.source, 'cisco-memory-pool');

  assert.equal(result.temperature.celsius, 38);
  assert.equal(result.temperature.thresholdCelsius, 65);
  assert.equal(result.temperature.source, 'cisco-envmon');
});

test('parseHardwareVarbinds handles missing hardware telemetry gracefully', () => {
  const varbinds = [
    { oid: HARDWARE_OIDS.sysDescr, value: 'Generic network device' },
  ];

  const result = parseHardwareVarbinds(varbinds);
  assert.equal(result.cpu.utilization, null);
  assert.ok(result.cpu.reason.includes('No supported CPU OID'));
  assert.equal(result.memory.utilization, null);
  assert.ok(result.memory.reason.includes('No supported memory OID'));
  assert.equal(result.temperature.celsius, null);
});

test('parseHardwareVarbinds discovers every processor row and the physical RAM storage index', () => {
  const result = parseHardwareVarbinds([
    { oid: `${HARDWARE_OIDS.hrProcessorLoadTable}.5`, value: 20 },
    { oid: `${HARDWARE_OIDS.hrProcessorLoadTable}.9`, value: 60 },
    { oid: `${HARDWARE_OIDS.hrStorageTypeTable}.7`, value: HARDWARE_OIDS.hrStorageRam },
    { oid: `${HARDWARE_OIDS.hrStorageAllocationUnitsTable}.7`, value: 4096 },
    { oid: `${HARDWARE_OIDS.hrStorageSizeTable}.7`, value: 1000 },
    { oid: `${HARDWARE_OIDS.hrStorageUsedTable}.7`, value: 750 },
    { oid: `${HARDWARE_OIDS.ciscoEnvMonTempTable}.4`, value: 41 },
    { oid: `${HARDWARE_OIDS.ciscoEnvMonThresholdTable}.4`, value: 70 },
  ]);

  assert.equal(result.cpu.utilization, 40);
  assert.deepEqual(result.cpu.perCore, [20, 60]);
  assert.equal(result.cpu.source, 'host-resources-processor');
  assert.equal(result.memory.utilization, 75);
  assert.equal(result.memory.source, 'host-resources-storage');
  assert.equal(result.memory.totalBytes, 4_096_000);
  assert.equal(result.temperature.celsius, 41);
  assert.equal(result.temperature.thresholdCelsius, 70);
});

test('parseHardwareVarbinds rejects invalid CPU percentages and memory table values', () => {
  const result = parseHardwareVarbinds([
    { oid: HARDWARE_OIDS.ucdCpuIdle, value: 101 },
    { oid: `${HARDWARE_OIDS.hrProcessorLoadTable}.7`, value: 101 },
    { oid: `${HARDWARE_OIDS.hrStorageTypeTable}.4`, value: HARDWARE_OIDS.hrStorageRam },
    { oid: `${HARDWARE_OIDS.hrStorageAllocationUnitsTable}.4`, value: 1024 },
    { oid: `${HARDWARE_OIDS.hrStorageSizeTable}.4`, value: 10 },
    { oid: `${HARDWARE_OIDS.hrStorageUsedTable}.4`, value: 12 },
  ]);
  assert.equal(result.cpu.utilization, null);
  assert.equal(result.memory.utilization, null);
  assert.equal(result.memory.totalBytes, null);
});

test('discoverSnmpInterfaces returns indexes, names, operational state, and link speed from IF-MIB', async () => {
  const session = {
    subtree(oid, repetitions, feed, done) {
      const rows = oid === '1.3.6.1.2.1.2.2.1'
        ? [
          { oid: `${oid}.2.3`, value: 'GigabitEthernet0/3' },
          { oid: `${oid}.5.3`, value: 1_000_000_000 },
          { oid: `${oid}.8.3`, value: 1 },
        ]
        : [
          { oid: `${oid}.1.3`, value: 'Gi0/3' },
          { oid: `${oid}.15.3`, value: 1000 },
        ];
      feed(rows);
      done(null);
    },
  };

  const result = await discoverSnmpInterfaces(session);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.interfaces, [{
    interfaceIndex: 3,
    description: 'GigabitEthernet0/3',
    speedBps: 1_000_000_000,
    operationalStatus: 1,
    name: 'Gi0/3',
    highSpeedMbps: 1000,
  }]);
});
