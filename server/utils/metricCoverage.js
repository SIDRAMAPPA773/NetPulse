const METRIC_COLLECTORS = {
  device_reachability: { path: 'status', source: 'ICMP or configured SNMP', supported: () => true },
  rtt_average: { path: 'latency', source: 'ICMP', supported: () => true, reasonKey: 'rtt' },
  rtt_minimum: { path: 'rttMin', source: 'ICMP', supported: () => true, reasonKey: 'rtt' },
  rtt_maximum: { path: 'rttMax', source: 'ICMP', supported: () => true, reasonKey: 'rtt' },
  rtt_stddev: { path: 'rttStddev', source: 'ICMP', supported: () => true, reasonKey: 'rtt' },
  rtt_jitter: { path: 'jitter', source: 'ICMP', supported: () => true, reasonKey: 'rtt' },
  packet_loss: { path: 'packetLoss', source: 'ICMP', supported: () => true, reasonKey: 'packetLoss' },
  availability: { path: 'availability', source: 'ICMP', supported: () => true },
  inbound_throughput: { path: 'incomingThroughputBps', source: 'SNMP IF-MIB or local Windows interface', supported: (device, latest) => device.monitoringMethod === 'snmp' || latest?.source === 'windows-interface-counters', reasonKey: 'inboundThroughput' },
  outbound_throughput: { path: 'outgoingThroughputBps', source: 'SNMP IF-MIB or local Windows interface', supported: (device, latest) => device.monitoringMethod === 'snmp' || latest?.source === 'windows-interface-counters', reasonKey: 'outboundThroughput' },
  inbound_packet_rate: { path: 'snmp.inPacketsPerSecond', source: 'SNMP IF-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'interfaceCounters' },
  outbound_packet_rate: { path: 'snmp.outPacketsPerSecond', source: 'SNMP IF-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'interfaceCounters' },
  inbound_interface_errors: { path: 'snmp.inErrors', source: 'SNMP IF-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'interfaceErrors' },
  outbound_interface_errors: { path: 'snmp.outErrors', source: 'SNMP IF-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'interfaceErrors' },
  inbound_dropped_packets: { path: 'snmp.inDiscards', source: 'SNMP IF-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'interfaceDrops' },
  outbound_dropped_packets: { path: 'snmp.outDiscards', source: 'SNMP IF-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'interfaceDrops' },
  interface_speed: { path: 'snmp.interfaceSpeed', source: 'SNMP IF-MIB ifSpeed', supported: (device) => device.monitoringMethod === 'snmp' },
  interface_operational_status: { path: 'snmp.operationalStatus', source: 'SNMP IF-MIB ifOperStatus', supported: (device) => device.monitoringMethod === 'snmp' },
  interface_utilization: { path: 'derived.inboundInterfaceUtilizationPercent', source: 'SNMP IF-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'inboundThroughput' },
  device_uptime: { path: 'derived.deviceUptimeSeconds', source: 'SNMP SNMPv2-MIB', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'deviceUptime' },
  cpu_utilization: { path: 'cpuUtilization', source: 'SNMP Host Resources/UCD-SNMP/vendor MIB or authorized host agent', supported: (device, latest) => device.monitoringMethod === 'snmp' || latest?.measurementSource === 'simulated', reasonKey: 'cpuUtilization' },
  memory_utilization: { path: 'memoryUtilization', source: 'SNMP Host Resources/UCD-SNMP/vendor MIB or authorized host agent', supported: (device, latest) => device.monitoringMethod === 'snmp' || latest?.measurementSource === 'simulated', reasonKey: 'memoryUtilization' },
  temperature: { path: 'hardware.temperature.celsius', source: 'Vendor environmental sensor OID', supported: (device) => device.monitoringMethod === 'snmp', reasonKey: 'temperature' },
};
const INTERFACE_METRIC_IDS = new Set([
  'inbound_throughput',
  'outbound_throughput',
  'inbound_packet_rate',
  'outbound_packet_rate',
  'inbound_interface_errors',
  'outbound_interface_errors',
  'inbound_dropped_packets',
  'outbound_dropped_packets',
  'interface_speed',
  'interface_operational_status',
  'interface_utilization',
]);

function readPath(value, path) {
  return path.split('.').reduce((result, part) => result == null ? null : result[part], value);
}

function metricStatus(metric, collector, device, latestMetric, now, freshnessWindowMs) {
  const oidChecks = latestMetric?.snmp?.oidChecks?.filter((check) => check.metricId === metric.id) || [];
  const oidCheck = oidChecks.find((check) => (
    ['AUTHENTICATION_FAILED', 'TIMEOUT', 'COLLECTION_ERROR'].includes(check.responseStatus)
  )) || oidChecks.find((check) => check.responseStatus !== 'UNSUPPORTED') || oidChecks[0];
  const everyOidUnsupported = oidChecks.length > 0
    && oidChecks.every((check) => check.responseStatus === 'UNSUPPORTED');
  const hardwareStatus = metric.id === 'cpu_utilization'
    ? latestMetric?.hardware?.availability?.cpu
    : metric.id === 'memory_utilization'
      ? latestMetric?.hardware?.availability?.memory
      : metric.id === 'temperature'
        ? latestMetric?.hardware?.availability?.temperature
        : null;
  const supported = Boolean(collector?.supported(device, latestMetric))
    && !everyOidUnsupported
    && hardwareStatus !== 'UNSUPPORTED';
  const interfaceNotConfigured = device.monitoringMethod === 'snmp'
    && INTERFACE_METRIC_IDS.has(metric.id)
    && !(Number.isInteger(Number(device.snmpInterfaceIndex)) && Number(device.snmpInterfaceIndex) > 0)
    && !(latestMetric?.source === 'windows-interface-counters');
  const observedValue = supported && latestMetric ? readPath(latestMetric, collector.path) : null;
  const value = metric.id === 'device_reachability'
    ? observedValue === 'UNKNOWN'
      ? null
      : observedValue === 'DOWN'
        ? false
        : ['UP', 'WARNING'].includes(observedValue) ? true : null
    : observedValue;
  const hasValue = value !== null && value !== undefined && (typeof value !== 'number' || Number.isFinite(value));
  const lastCollectedAt = (supported || oidCheck) && latestMetric?.createdAt ? latestMetric.createdAt : null;
  const ageMs = lastCollectedAt ? now - new Date(lastCollectedAt).getTime() : null;
  const unavailableReasons = latestMetric?.derived?.unavailableMetrics || {};
  const reason = collector?.reasonKey
    ? unavailableReasons[collector.reasonKey] || latestMetric?.reasonUnavailable || null
    : latestMetric?.reasonUnavailable || null;

  const snmpErrorCode = latestMetric?.snmp?.errorCode;
  const checkErrorCode = oidCheck?.responseStatus;
  let status;
  if (!supported) status = 'UNSUPPORTED';
  else if (hasValue && ageMs > freshnessWindowMs) status = 'STALE';
  else if (hasValue && latestMetric?.measurementSource === 'simulated') status = 'SIMULATED';
  else if (hasValue) status = 'AVAILABLE';
  else if (latestMetric?.measurementSource === 'simulated') status = 'SIMULATED';
  else if (checkErrorCode === 'NOT_CONFIGURED' || snmpErrorCode === 'NOT_CONFIGURED') status = 'NOT_CONFIGURED';
  else if (interfaceNotConfigured) status = 'NOT_CONFIGURED';
  else if (!latestMetric) status = 'PENDING';
  else if (checkErrorCode === 'AUTHENTICATION_FAILED' || snmpErrorCode === 'AUTHENTICATION_FAILED') status = 'AUTHENTICATION_FAILED';
  else if (checkErrorCode === 'TIMEOUT' || snmpErrorCode === 'TIMEOUT') status = 'TIMEOUT';
  else if (checkErrorCode === 'COLLECTION_ERROR' || snmpErrorCode === 'COLLECTION_ERROR') status = 'COLLECTION_ERROR';
  else if (latestMetric?.collectionStatus === 'timeout') status = 'UNREACHABLE';
  else if (latestMetric?.collectionStatus === 'error') status = 'COLLECTION_ERROR';
  else if (latestMetric?.collectionStatus === 'blocked') status = 'UNAVAILABLE';
  else status = 'UNAVAILABLE';

  let metricReason = null;
  if (status === 'UNSUPPORTED') metricReason = oidCheck?.reason || reason || metric.limitations;
  else if (status === 'PENDING') metricReason = 'No collection has been recorded for this device yet';
  else if (status === 'NOT_CONFIGURED') {
    metricReason = interfaceNotConfigured
      ? 'Configure an SNMP interface index to collect this interface metric'
      : latestMetric?.snmp?.reason || latestMetric?.reasonUnavailable || 'Collector is not configured';
  } else if (!['AVAILABLE', 'SIMULATED', 'STALE', 'PENDING'].includes(status)) {
    metricReason = reason || oidCheck?.reason || (status === 'UNREACHABLE'
      ? 'The device did not respond to the configured collection request'
      : status === 'AUTHENTICATION_FAILED'
        ? 'SNMP authentication failed; verify configured credentials'
        : status === 'TIMEOUT'
          ? 'The collector timed out waiting for the device'
          : metric.id === 'device_reachability' && observedValue === 'UNKNOWN'
            ? 'No successful reachability response is available'
            : 'No successful sample has been collected');
  }

  return {
    id: metric.id,
    name: metric.name,
    value: hasValue ? value : null,
    unit: metric.unit,
    source: latestMetric?.measurementSource === 'simulated'
      ? 'Simulation'
      : latestMetric?.hardware?.cpu?.source && metric.id === 'cpu_utilization'
        ? latestMetric.hardware.cpu.source
        : latestMetric?.hardware?.memory?.source && metric.id === 'memory_utilization'
          ? latestMetric.hardware.memory.source
          : latestMetric?.hardware?.temperature?.source && metric.id === 'temperature'
            ? latestMetric.hardware.temperature.source
            : (supported ? latestMetric?.source || collector?.source || metric.source : collector?.source || metric.source),
    lastCollectedAt,
    freshnessSeconds: ageMs === null ? null : Math.max(0, Math.floor(ageMs / 1000)),
    freshness: ageMs === null ? 'unknown' : ageMs > freshnessWindowMs ? 'stale' : 'fresh',
    collectionDuration: latestMetric?.derived?.pollingDurationMs ?? null,
    collectionDurationMs: latestMetric?.derived?.pollingDurationMs ?? null,
    supported,
    status,
    errorCode: status === 'UNSUPPORTED'
      ? 'UNSUPPORTED'
      : status === 'NOT_CONFIGURED'
        ? 'NOT_CONFIGURED'
        : status === 'AUTHENTICATION_FAILED' || status === 'TIMEOUT' || status === 'COLLECTION_ERROR'
          ? status
          : null,
    reason: metricReason,
  };
}

function summarizeMetricCoverage(metrics) {
  const summary = {
    totalSupportedMetrics: 0,
    successfullyCollectedMetrics: 0,
    unavailableMetrics: 0,
    staleMetrics: 0,
    errorMetrics: 0,
    unsupportedMetrics: 0,
    simulatedMetrics: 0,
    pendingMetrics: 0,
    notConfiguredMetrics: 0,
    authenticationFailedMetrics: 0,
    unreachableMetrics: 0,
    timeoutMetrics: 0,
    collectionErrorMetrics: 0,
    coveragePercent: 0,
  };

  for (const metric of metrics) {
    if (metric.status === 'UNSUPPORTED') summary.unsupportedMetrics += 1;
    else {
      summary.totalSupportedMetrics += 1;
      if (metric.status === 'AVAILABLE' || metric.status === 'SIMULATED') summary.successfullyCollectedMetrics += 1;
      if (metric.status === 'SIMULATED') summary.simulatedMetrics += 1;
      if (metric.status === 'UNAVAILABLE') summary.unavailableMetrics += 1;
      if (metric.status === 'STALE') summary.staleMetrics += 1;
      if (metric.status === 'PENDING') summary.pendingMetrics += 1;
      if (metric.status === 'NOT_CONFIGURED') summary.notConfiguredMetrics += 1;
      if (metric.status === 'AUTHENTICATION_FAILED') summary.authenticationFailedMetrics += 1;
      if (metric.status === 'UNREACHABLE') summary.unreachableMetrics += 1;
      if (metric.status === 'TIMEOUT') summary.timeoutMetrics += 1;
      if (metric.status === 'COLLECTION_ERROR') summary.collectionErrorMetrics += 1;
      if (['ERROR', 'AUTHENTICATION_FAILED', 'TIMEOUT', 'COLLECTION_ERROR'].includes(metric.status)) summary.errorMetrics += 1;
    }
  }
  summary.coveragePercent = summary.totalSupportedMetrics
    ? Number((summary.successfullyCollectedMetrics / summary.totalSupportedMetrics * 100).toFixed(1))
    : 0;
  return summary;
}

function createMetricCoverage(device, latestMetric, registry, now = Date.now()) {
  const pollingSeconds = Number(device.pollingInterval) || 30;
  const freshnessWindowMs = Math.max(120_000, pollingSeconds * 4_000);
  const metrics = registry.map((metric) => metricStatus(
    metric,
    METRIC_COLLECTORS[metric.id],
    device,
    latestMetric,
    now,
    freshnessWindowMs,
  ));
  return { metrics, summary: summarizeMetricCoverage(metrics) };
}

module.exports = { createMetricCoverage, summarizeMetricCoverage };
