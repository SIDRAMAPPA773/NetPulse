const test = require('node:test');
const assert = require('node:assert/strict');
const { getAll } = require('../config/metricsRegistry');
const { createMetricCoverage, summarizeMetricCoverage } = require('../utils/metricCoverage');

const device = {
  _id: 'device-id',
  monitoringMethod: 'icmp',
  pollingInterval: 30,
};

test('metric coverage distinguishes collected, unsupported, and unavailable values', () => {
  const { metrics, summary } = createMetricCoverage(device, {
    createdAt: new Date(1_000),
    status: 'UP',
    latency: 23.5,
    packetLoss: 0,
    availability: 100,
    measurementSource: 'real',
    collectionStatus: 'success',
    derived: { unavailableMetrics: { cpuUtilization: 'No device CPU collector configured' } },
  }, getAll(), 2_000);

  assert.equal(metrics.find(metric => metric.id === 'rtt_average').status, 'AVAILABLE');
  assert.equal(metrics.find(metric => metric.id === 'rtt_average').value, 23.5);
  assert.equal(metrics.find(metric => metric.id === 'cpu_utilization').status, 'UNSUPPORTED');
  assert.equal(metrics.find(metric => metric.id === 'dns_response_time').status, 'UNSUPPORTED');
  assert.equal(metrics.find(metric => metric.id === 'temperature').status, 'UNSUPPORTED');
  assert.equal(metrics.find(metric => metric.id === 'inbound_throughput').status, 'UNSUPPORTED');
  assert.equal(metrics.find(metric => metric.id === 'device_reachability').value, true);
  assert.ok(summary.totalSupportedMetrics > 0);
  assert.equal(summary.successfullyCollectedMetrics, 4);
});

test('metric coverage marks stale values and never substitutes zero for missing data', () => {
  const { metrics, summary } = createMetricCoverage(device, {
    createdAt: new Date(1_000),
    latency: 23,
    packetLoss: null,
    collectionStatus: 'success',
    measurementSource: 'real',
    derived: { unavailableMetrics: { packetLoss: 'No valid packet-loss sample' } },
  }, getAll(), 200_000);
  assert.equal(metrics.find(metric => metric.id === 'rtt_average').status, 'STALE');
  assert.equal(metrics.find(metric => metric.id === 'rtt_average').value, 23);
  assert.equal(metrics.find(metric => metric.id === 'packet_loss').status, 'UNAVAILABLE');
  assert.equal(metrics.find(metric => metric.id === 'packet_loss').value, null);
  assert.equal(metrics.find(metric => metric.id === 'packet_loss').reason, 'No valid packet-loss sample');
  assert.ok(summary.staleMetrics > 0);
});

test('collection errors are separate from unavailable and unsupported metric counts', () => {
  const metric = { status: 'ERROR' };
  const summary = summarizeMetricCoverage([metric, { status: 'UNAVAILABLE' }, { status: 'STALE' }, { status: 'UNSUPPORTED' }]);
  assert.equal(summary.totalSupportedMetrics, 3);
  assert.equal(summary.errorMetrics, 1);
  assert.equal(summary.unavailableMetrics, 1);
  assert.equal(summary.staleMetrics, 1);
  assert.equal(summary.unsupportedMetrics, 1);
  assert.equal(summary.coveragePercent, 0);
});

test('unknown reachability is unavailable rather than a successfully collected value', () => {
  const { metrics } = createMetricCoverage(device, {
    createdAt: new Date(1_000),
    status: 'UNKNOWN',
    collectionStatus: 'blocked',
    reasonUnavailable: 'Target is not authorized',
  }, getAll(), 2_000);
  const reachability = metrics.find(metric => metric.id === 'device_reachability');
  assert.equal(reachability.status, 'UNAVAILABLE');
  assert.equal(reachability.value, null);
  assert.equal(reachability.reason, 'Target is not authorized');
});

test('reachability preserves a measured offline false value and labels simulated sources', () => {
  const { metrics } = createMetricCoverage(device, {
    createdAt: new Date(1_000),
    status: 'DOWN',
    measurementSource: 'simulated',
    collectionStatus: 'simulated',
  }, getAll(), 2_000);
  const reachability = metrics.find(metric => metric.id === 'device_reachability');
  assert.equal(reachability.status, 'SIMULATED');
  assert.equal(reachability.value, false);
  assert.equal(reachability.source, 'Simulation');
});

test('SNMP interface speed and operational status report only populated samples', () => {
  const snmpDevice = { ...device, monitoringMethod: 'snmp' };
  const { metrics } = createMetricCoverage(snmpDevice, {
    createdAt: new Date(1_000),
    measurementSource: 'real',
    collectionStatus: 'success',
    snmp: { interfaceSpeed: 1_000_000_000, operationalStatus: 1 },
  }, getAll(), 2_000);
  const speed = metrics.find(metric => metric.id === 'interface_speed');
  const status = metrics.find(metric => metric.id === 'interface_operational_status');
  assert.equal(speed.status, 'AVAILABLE');
  assert.equal(speed.value, 1_000_000_000);
  assert.equal(status.status, 'AVAILABLE');
  assert.equal(status.value, 1);
});

test('hardware coverage distinguishes supported, unsupported, timed-out, and simulated readings', () => {
  const snmpDevice = { ...device, monitoringMethod: 'snmp' };
  const unsupported = createMetricCoverage(snmpDevice, {
    createdAt: new Date(1_000),
    measurementSource: 'real',
    collectionStatus: 'success',
    status: 'UP',
    hardware: {
      cpu: { utilization: null, reason: 'CPU OID is not exposed' },
      memory: { utilization: null, reason: 'Physical memory table is not exposed' },
      temperature: { celsius: null, reason: 'No environmental sensor OID responded' },
    },
    snmp: {
      responded: true,
      oidChecks: [
        { metricId: 'cpu_utilization', responseStatus: 'UNSUPPORTED', reason: 'CPU OID is not exposed' },
        { metricId: 'memory_utilization', responseStatus: 'UNSUPPORTED', reason: 'Physical memory table is not exposed' },
        { metricId: 'temperature', responseStatus: 'UNSUPPORTED', reason: 'No environmental sensor OID responded' },
      ],
    },
    derived: {
      unavailableMetrics: {
        cpuUtilization: 'CPU OID is not exposed',
        memoryUtilization: 'Physical memory table is not exposed',
        temperature: 'No environmental sensor OID responded',
      },
    },
  }, getAll(), 2_000);

  for (const id of ['cpu_utilization', 'memory_utilization', 'temperature']) {
    const metric = unsupported.metrics.find(row => row.id === id);
    assert.equal(metric.status, 'UNSUPPORTED');
    assert.equal(metric.value, null);
    assert.match(metric.reason, /OID|table|sensor/);
    assert.equal(metric.supported, false);
  }

  const timeout = createMetricCoverage(snmpDevice, {
    createdAt: new Date(1_000),
    measurementSource: 'real',
    status: 'UP',
    snmp: { errorCode: 'TIMEOUT', oidChecks: [{ metricId: 'cpu_utilization', responseStatus: 'TIMEOUT' }] },
  }, getAll(), 2_000);
  assert.equal(timeout.metrics.find(row => row.id === 'cpu_utilization').status, 'TIMEOUT');

  const simulated = createMetricCoverage(device, {
    createdAt: new Date(1_000),
    measurementSource: 'simulated',
    cpuUtilization: 24,
  }, getAll(), 2_000);
  const cpu = simulated.metrics.find(row => row.id === 'cpu_utilization');
  assert.equal(cpu.status, 'SIMULATED');
  assert.equal(cpu.source, 'Simulation');
  assert.equal(cpu.value, 24);
});

test('interface utilization remains null without a reported speed and interfaces require an index', () => {
  const snmpDevice = { ...device, monitoringMethod: 'snmp', snmpInterfaceIndex: 7 };
  const withTrafficNoSpeed = createMetricCoverage(snmpDevice, {
    createdAt: new Date(1_000),
    measurementSource: 'real',
    collectionStatus: 'success',
    incomingThroughputBps: 50_000,
    outgoingThroughputBps: 40_000,
    snmp: { interfaceSpeed: null },
    derived: {
      inboundInterfaceUtilizationPercent: null,
      outboundInterfaceUtilizationPercent: null,
      unavailableMetrics: { inboundThroughput: 'Interface speed was not reported' },
    },
  }, getAll(), 2_000);
  const utilization = withTrafficNoSpeed.metrics.find(row => row.id === 'interface_utilization');
  assert.equal(utilization.value, null);
  assert.equal(utilization.status, 'UNAVAILABLE');

  const noIndex = createMetricCoverage({ ...device, monitoringMethod: 'snmp' }, null, getAll(), 2_000);
  assert.equal(noIndex.metrics.find(row => row.id === 'inbound_interface_errors').status, 'NOT_CONFIGURED');

  const missingIndexAfterPoll = createMetricCoverage({ ...device, monitoringMethod: 'snmp' }, {
    createdAt: new Date(1_000),
    measurementSource: 'real',
    collectionStatus: 'success',
  }, getAll(), 2_000);
  const errors = missingIndexAfterPoll.metrics.find(row => row.id === 'inbound_interface_errors');
  assert.equal(errors.status, 'NOT_CONFIGURED');
  assert.match(errors.reason, /interface index/i);
});

test('coverage reports authentication failures and pending supported metrics explicitly', () => {
  const snmpDevice = { ...device, monitoringMethod: 'snmp', snmpInterfaceIndex: 7 };
  const authFailure = createMetricCoverage(snmpDevice, {
    createdAt: new Date(1_000),
    measurementSource: 'real',
    snmp: {
      errorCode: 'AUTHENTICATION_FAILED',
      oidChecks: [{ metricId: 'cpu_utilization', responseStatus: 'AUTHENTICATION_FAILED' }],
    },
  }, getAll(), 2_000);
  assert.equal(authFailure.metrics.find(row => row.id === 'cpu_utilization').status, 'AUTHENTICATION_FAILED');

  const pending = createMetricCoverage(snmpDevice, null, getAll(), 2_000);
  assert.equal(pending.metrics.find(row => row.id === 'device_uptime').status, 'PENDING');
  assert.equal(pending.metrics.find(row => row.id === 'device_uptime').value, null);
});
