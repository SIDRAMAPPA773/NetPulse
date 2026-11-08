const Alert = require('../models/Alert');
const { getIO } = require('./socketService');

async function processDeviceAnomalies({
  device,
  currentMetric,
  previousMetrics = [],
  thresholds = {},
}) {
  if (!device || !currentMetric) return [];

  const detectedAnomalies = [];
  const now = new Date();

  const LATENCY_CRITICAL = thresholds.LATENCY_CRITICAL || 250;
  const LATENCY_WARNING = thresholds.LATENCY_WARNING || 100;
  const PACKET_LOSS_CRITICAL = thresholds.PACKET_LOSS_CRITICAL || 15;
  const CPU_CRITICAL = thresholds.CPU_CRITICAL || 95;
  const MEMORY_CRITICAL = thresholds.MEMORY_CRITICAL || 95;

  // 1. Sudden Latency Spike / High Latency
  if (typeof currentMetric.latency === 'number' && currentMetric.latency >= LATENCY_WARNING) {
    const isCritical = currentMetric.latency >= LATENCY_CRITICAL;
    const pastValidLatencies = previousMetrics
      .map((m) => m?.latency)
      .filter((l) => typeof l === 'number' && l >= 0);

    let isSuddenSpike = false;
    let avgPast = null;
    if (pastValidLatencies.length >= 3) {
      avgPast = Math.round(pastValidLatencies.reduce((a, b) => a + b, 0) / pastValidLatencies.length);
      if (currentMetric.latency > avgPast * 2.5 && currentMetric.latency > 50) {
        isSuddenSpike = true;
      }
    }

    detectedAnomalies.push({
      type: isSuddenSpike ? 'SUDDEN_LATENCY_SPIKE' : 'HIGH_LATENCY',
      severity: isCritical ? 'CRITICAL' : 'HIGH',
      message: isSuddenSpike
        ? `Sudden latency jump detected on ${device.ipAddress}: ${currentMetric.latency}ms (fleet baseline: ${avgPast}ms)`
        : `High round-trip latency on ${device.ipAddress}: ${currentMetric.latency}ms`,
      evidence: {
        latency: currentMetric.latency,
        baselineLatency: avgPast,
        rttMin: currentMetric.rttMin,
        rttMax: currentMetric.rttMax,
      },
      rootCauseHint: 'Network congestion, bufferbloat, routing asymmetry, or overloaded intermediate switch/router',
    });
  }

  // 2. High Packet Loss
  if (typeof currentMetric.packetLoss === 'number' && currentMetric.packetLoss >= (thresholds.PACKET_LOSS_WARNING || 5)) {
    const isCritical = currentMetric.packetLoss >= PACKET_LOSS_CRITICAL;
    detectedAnomalies.push({
      type: 'HIGH_PACKET_LOSS',
      severity: isCritical ? 'CRITICAL' : 'HIGH',
      message: `Packet loss on ${device.ipAddress} reached ${currentMetric.packetLoss}%`,
      evidence: {
        packetLoss: currentMetric.packetLoss,
        availability: currentMetric.availability,
      },
      rootCauseHint: 'Failing physical cabling, link duplex mismatch, Wi-Fi interference, or queue drops under load',
    });
  }

  // 3. Jitter / Instability Anomaly
  if (typeof currentMetric.jitter === 'number' && currentMetric.jitter >= 25) {
    detectedAnomalies.push({
      type: 'HIGH_JITTER',
      severity: currentMetric.jitter >= 50 ? 'HIGH' : 'MEDIUM',
      message: `High latency variation (jitter) on ${device.ipAddress}: ${currentMetric.jitter}ms`,
      evidence: { jitter: currentMetric.jitter },
      rootCauseHint: 'Route flapping, packet serialization delays, bursty traffic, or wireless medium contention',
    });
  }

  // 4. Repeated Device Disconnections / Flapping
  const pastStatuses = previousMetrics
    .slice(0, 10)
    .map((m) => m?.status)
    .filter(Boolean);
  let stateTransitions = 0;
  for (let i = 1; i < pastStatuses.length; i++) {
    if (pastStatuses[i] !== pastStatuses[i - 1]) stateTransitions++;
  }
  if (stateTransitions >= 4) {
    detectedAnomalies.push({
      type: 'DEVICE_FLAPPING',
      severity: 'HIGH',
      message: `Device ${device.ipAddress} is flapping rapidly (${stateTransitions} state changes in recent cycles)`,
      evidence: { stateTransitions, recentStatuses: pastStatuses },
      rootCauseHint: 'Intermittent power supply, reboot loop, STP topology changes, or conflicting IP assignment',
    });
  }

  // 5. Hardware CPU / Memory Thresholds
  if (typeof currentMetric.cpuUtilization === 'number' && currentMetric.cpuUtilization >= (thresholds.CPU_WARNING || 80)) {
    const isCrit = currentMetric.cpuUtilization >= CPU_CRITICAL;
    detectedAnomalies.push({
      type: 'HIGH_CPU_UTILIZATION',
      severity: isCrit ? 'CRITICAL' : 'HIGH',
      message: `CPU utilization on ${device.name || device.ipAddress} reached ${currentMetric.cpuUtilization}%`,
      evidence: { cpuUtilization: currentMetric.cpuUtilization },
      rootCauseHint: 'Runaway process, broadcast storm, high interrupt load, or denial of service',
    });
  }

  if (typeof currentMetric.memoryUtilization === 'number' && currentMetric.memoryUtilization >= (thresholds.MEMORY_WARNING || 85)) {
    const isCrit = currentMetric.memoryUtilization >= MEMORY_CRITICAL;
    detectedAnomalies.push({
      type: 'HIGH_MEMORY_UTILIZATION',
      severity: isCrit ? 'CRITICAL' : 'HIGH',
      message: `Memory utilization on ${device.name || device.ipAddress} reached ${currentMetric.memoryUtilization}%`,
      evidence: { memoryUtilization: currentMetric.memoryUtilization },
      rootCauseHint: 'Memory leak in daemon/service, large table cache growth, or insufficient physical RAM',
    });
  }

  // 6. Interface Error / Discard Rates
  const snmpTelemetry = currentMetric.snmp;
  if (snmpTelemetry && (snmpTelemetry.inErrors > 0 || snmpTelemetry.outErrors > 0)) {
    detectedAnomalies.push({
      type: 'INTERFACE_ERRORS',
      severity: 'MEDIUM',
      message: `Interface errors detected on ${device.ipAddress}: Inbound=${snmpTelemetry.inErrors}, Outbound=${snmpTelemetry.outErrors}`,
      evidence: { inErrors: snmpTelemetry.inErrors, outErrors: snmpTelemetry.outErrors },
      rootCauseHint: 'Damaged cable, dirty optic, CRC checksum errors, or framing alignment issues',
    });
  }

  // 7. Deduplicate and persist alerts (Avoid repeated alerts for the same active condition)
  const activeAlerts = await Alert.find({ device: device._id, status: 'ACTIVE' });
  const activeTypes = new Set(activeAlerts.map((a) => a.type));
  const detectedTypes = new Set(detectedAnomalies.map((a) => a.type));

  // Update existing or create new alerts
  for (const anomaly of detectedAnomalies) {
    const existing = activeAlerts.find((a) => a.type === anomaly.type);
    if (existing) {
      existing.lastOccurredAt = now;
      existing.occurrenceCount = (existing.occurrenceCount || 1) + 1;
      existing.evidence = anomaly.evidence;
      existing.message = anomaly.message;
      await existing.save();
    } else {
      const createdAlert = await Alert.create({
        device: device._id,
        type: anomaly.type,
        severity: anomaly.severity,
        message: anomaly.message,
        ipAddress: device.ipAddress,
        evidence: anomaly.evidence,
        rootCauseHint: anomaly.rootCauseHint,
        firstOccurredAt: now,
        lastOccurredAt: now,
        occurrenceCount: 1,
        status: 'ACTIVE',
      });
      try {
        const io = getIO();
        if (io) io.emit('alert:new', createdAlert);
      } catch {}
    }
  }

  // Auto-resolve cleared alert conditions
  for (const existing of activeAlerts) {
    if (!detectedTypes.has(existing.type) && !['IP_MAC_MAPPING_CHANGED', 'HOSTNAME_CHANGED'].includes(existing.type)) {
      existing.status = 'RESOLVED';
      existing.resolvedAt = now;
      await existing.save();
    }
  }

  return detectedAnomalies;
}

function computeFleetAnalytics(devices = [], recentMetrics = []) {
  const totalObservedIps = devices.filter((d) => d.monitoringTier === 'observed' || d.isPassiveOnly).length;
  const totalAuthorizedMonitoredIps = devices.filter((d) => d.monitoringTier === 'authorized' && !d.isPassiveOnly).length;

  // Active verified devices ONLY include authorized monitored devices verified active
  const verifiedOnline = devices.filter((d) => !d.isPassiveOnly && d.status === 'UP').length;
  const verifiedOffline = devices.filter((d) => !d.isPassiveOnly && d.status === 'DOWN').length;
  const unknownStatus = devices.filter((d) => d.isPassiveOnly || d.status === 'UNKNOWN').length;

  const now = Date.now();
  const recentlyObserved = devices.filter((d) => {
    const t = new Date(d.lastObservedAt || d.lastSeen || 0).getTime();
    return now - t <= 3600 * 1000;
  }).length;

  const staleDevices = devices.filter((d) => {
    if (d.isPassiveOnly) return false;
    const t = new Date(d.lastSeen || 0).getTime();
    return now - t > 300 * 1000;
  }).length;

  const incompleteTelemetry = devices.filter((d) => {
    return d.healthScore !== null && (d.healthScore < 50 || d.status === 'UNKNOWN');
  }).length;

  // Compute fleet latency and availability from valid metrics
  const validLatencies = recentMetrics
    .map((m) => m?.latency)
    .filter((l) => typeof l === 'number' && Number.isFinite(l) && l >= 0);
  const avgFleetLatency = validLatencies.length > 0
    ? Math.round((validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length) * 10) / 10
    : null;

  const validJitters = recentMetrics
    .map((m) => m?.jitter)
    .filter((j) => typeof j === 'number' && Number.isFinite(j) && j >= 0);
  const avgFleetJitter = validJitters.length > 0
    ? Math.round((validJitters.reduce((a, b) => a + b, 0) / validJitters.length) * 10) / 10
    : null;

  const validLosses = recentMetrics
    .map((m) => m?.packetLoss)
    .filter((l) => typeof l === 'number' && Number.isFinite(l) && l >= 0);
  const avgFleetLoss = validLosses.length > 0
    ? Math.round((validLosses.reduce((a, b) => a + b, 0) / validLosses.length) * 10) / 10
    : null;

  // Rankings
  const authorizedDevices = devices.filter((d) => !d.isPassiveOnly);
  const highestLatencyDevices = [...authorizedDevices]
    .filter((d) => typeof d.latestMetric?.latency === 'number')
    .sort((a, b) => (b.latestMetric?.latency || 0) - (a.latestMetric?.latency || 0))
    .slice(0, 5)
    .map((d) => ({ id: d._id, name: d.name, ipAddress: d.ipAddress, latency: d.latestMetric?.latency }));

  const lowestLatencyDevices = [...authorizedDevices]
    .filter((d) => typeof d.latestMetric?.latency === 'number')
    .sort((a, b) => (a.latestMetric?.latency || 0) - (b.latestMetric?.latency || 0))
    .slice(0, 5)
    .map((d) => ({ id: d._id, name: d.name, ipAddress: d.ipAddress, latency: d.latestMetric?.latency }));

  const packetLossRanking = [...authorizedDevices]
    .filter((d) => typeof d.latestMetric?.packetLoss === 'number' && d.latestMetric?.packetLoss > 0)
    .sort((a, b) => (b.latestMetric?.packetLoss || 0) - (a.latestMetric?.packetLoss || 0))
    .slice(0, 5)
    .map((d) => ({ id: d._id, name: d.name, ipAddress: d.ipAddress, packetLoss: d.latestMetric?.packetLoss }));

  // Device type distribution
  const typeDistribution = {};
  for (const d of devices) {
    const t = d.type || 'unknown';
    typeDistribution[t] = (typeDistribution[t] || 0) + 1;
  }

  // Vendor distribution
  const vendorDistribution = {};
  for (const d of devices) {
    const v = d.vendor || 'Unknown';
    vendorDistribution[v] = (vendorDistribution[v] || 0) + 1;
  }

  return {
    totalObservedIps,
    totalAuthorizedMonitoredIps,
    verifiedOnline,
    verifiedOffline,
    unknownStatus,
    recentlyObserved,
    staleDevices,
    incompleteTelemetry,
    avgFleetLatency,
    avgFleetJitter,
    avgFleetLoss,
    highestLatencyDevices,
    lowestLatencyDevices,
    packetLossRanking,
    typeDistribution,
    vendorDistribution,
  };
}

module.exports = {
  processDeviceAnomalies,
  computeFleetAnalytics,
};
