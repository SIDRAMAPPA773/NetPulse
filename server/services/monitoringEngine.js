const cron = require('node-cron');
const snmp = require('net-snmp');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const Setting = require('../models/Setting');
const { getIO } = require('./socketService');
const { probeIcmp, computeJitter } = require('../utils/icmpProbe');
const {
  computeCounterDelta,
  computeThroughputBps,
  computeStats,
} = require('../utils/metricUtils');
const { Semaphore, createRateLimiter } = require('../utils/safety');
const { isDeviceDueForPolling } = require('../utils/pollSchedule');
const {
  calculateInterfaceRates,
  readWindowsInterfaceCounters,
} = require('../utils/windowsInterfaceCounters');
const {
  isTargetAllowed,
  parseAllowlist,
  setEmergencyStop,
  isEmergencyStopActive,
} = require('../utils/networkSafety');

const POLL_INTERVAL_SECONDS = 10;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_MAX_PROBES_PER_SECOND = 5;
const snmpState = new Map();
const lastPolledAt = new Map();
const localInterfaceCounterBaselines = new Map();

let simulationMode = true;
let monitoringStarted = false;
let cycleRunning = false;
let monitoringTask = null;
let currentCyclePromise = null;
let thresholds = {
  LATENCY_WARNING: 100,
  LATENCY_CRITICAL: 250,
  PACKET_LOSS_WARNING: 5,
  PACKET_LOSS_CRITICAL: 15,
};

function isEnabled(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true';
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

async function updateSettingsCache() {
  const settings = await Setting.find({
    key: { $in: ['SIMULATION_MODE', 'EMERGENCY_STOP', ...Object.keys(thresholds)] },
  });
  const values = new Map(settings.map((setting) => [setting.key, setting.value]));
  simulationMode = isEnabled(values.get('SIMULATION_MODE'), true);
  setEmergencyStop(isEnabled(values.get('EMERGENCY_STOP')));
  for (const key of Object.keys(thresholds)) {
    const value = Number(values.get(key));
    if (Number.isFinite(value)) thresholds[key] = value;
  }
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function collectSnmp(device) {
  if (device.snmpVersion === '3') {
    return { supported: false, reason: 'SNMPv3 credentials are not configured by this application' };
  }
  if (!device.snmpCommunity) {
    return { supported: false, reason: 'SNMP community is not configured' };
  }

  const ifIndex = Number(device.snmpInterfaceIndex);
  const oids = ['1.3.6.1.2.1.1.3.0'];
  if (Number.isInteger(ifIndex) && ifIndex > 0) {
    oids.push(
      `1.3.6.1.2.1.2.2.1.10.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.16.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.2.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.11.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.17.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.14.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.20.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.13.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.19.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.5.${ifIndex}`,
      `1.3.6.1.2.1.2.2.1.8.${ifIndex}`,
    );
  }

  const version = device.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
  const session = snmp.createSession(device.ipAddress, device.snmpCommunity, {
    version,
    timeout: 1500,
    retries: 0,
  });

  const result = await new Promise((resolve) => {
    session.get(oids, (error, varbinds) => {
      session.close();
      if (error) {
        resolve({ supported: false, reason: 'SNMP request failed' });
        return;
      }

      const values = {};
      let interfaceName = null;
      let unsupported = false;
      for (const varbind of varbinds) {
        if (snmp.isVarbindError(varbind)) {
          unsupported = true;
          continue;
        }
        if (varbind.oid === `1.3.6.1.2.1.2.2.1.2.${ifIndex}`) {
          interfaceName = String(varbind.value);
        } else {
          values[varbind.oid] = numericValue(varbind.value);
        }
      }

      const read = (suffix) => values[`1.3.6.1.2.1.2.2.1.${suffix}.${ifIndex}`] ?? null;
      const data = {
        supported: true,
        sysUpTime: values['1.3.6.1.2.1.1.3.0'] ?? null,
        ifIndex: Number.isInteger(ifIndex) && ifIndex > 0 ? ifIndex : null,
        interfaceName,
        inOctets: read(10),
        outOctets: read(16),
        inPackets: read(11),
        outPackets: read(17),
        inErrors: read(14),
        outErrors: read(20),
        inDiscards: read(13),
        outDiscards: read(19),
        interfaceSpeed: read(5),
        operationalStatus: read(8),
        countersSupported: Number.isInteger(ifIndex) && ifIndex > 0 && !unsupported,
      };
      if (!data.ifIndex) data.reason = 'Configure an interface index to collect interface counters';
      else if (unsupported) data.reason = 'One or more requested interface counters are unsupported';
      else if (data.inOctets !== null && data.outOctets !== null) {
        data.reason = 'Waiting for a second SNMP interface-counter sample';
      }
      resolve(data);
    });
  });

  if (!result.supported || !result.ifIndex || result.inOctets === null || result.outOctets === null) {
    return result;
  }

  const stateKey = `${device._id}:${result.ifIndex}:${result.interfaceName || ''}`;
  const now = Date.now();
  const previous = snmpState.get(stateKey);
  if (previous) {
    const elapsedSeconds = (now - previous.timestamp) / 1000;
    const inDelta = computeCounterDelta(previous.inOctets, result.inOctets, elapsedSeconds, 32);
    const outDelta = computeCounterDelta(previous.outOctets, result.outOctets, elapsedSeconds, 32);
    const inPacketDelta = computeCounterDelta(previous.inPackets, result.inPackets, elapsedSeconds, 32);
    const outPacketDelta = computeCounterDelta(previous.outPackets, result.outPackets, elapsedSeconds, 32);
    result.elapsedSeconds = elapsedSeconds;
    result.inDelta = inDelta;
    result.outDelta = outDelta;
    result.inBps = computeThroughputBps(inDelta, elapsedSeconds);
    result.outBps = computeThroughputBps(outDelta, elapsedSeconds);
    result.inPacketsPerSecond = inPacketDelta === null ? null : inPacketDelta / elapsedSeconds;
    result.outPacketsPerSecond = outPacketDelta === null ? null : outPacketDelta / elapsedSeconds;
    result.counterReset = (
      result.inOctets < previous.inOctets && inDelta === null
    ) || (
      result.outOctets < previous.outOctets && outDelta === null
    );
  }

  snmpState.set(stateKey, {
    inOctets: result.inOctets,
    outOctets: result.outOctets,
    inPackets: result.inPackets,
    outPackets: result.outPackets,
    timestamp: now,
  });
  return result;
}

async function upsertAlert(device, type, severity, message) {
  let alert = await Alert.findOne({
    device: device._id,
    type,
    status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] },
  });

  if (alert) {
    alert.lastOccurredAt = new Date();
    alert.occurrenceCount = (alert.occurrenceCount || 1) + 1;
    alert.message = message;
    alert.severity = severity;
    await alert.save();
    return alert;
  }

  alert = await Alert.create({
    device: device._id,
    type,
    severity,
    message,
    firstOccurredAt: new Date(),
    lastOccurredAt: new Date(),
    occurrenceCount: 1,
  });
  const alertWithDevice = await Alert.findById(alert._id).populate('device', 'name ipAddress type location');
  getIO().emit('newAlert', alertWithDevice);
  return alert;
}

async function resolveAlert(device, type) {
  await Alert.updateMany(
    { device: device._id, type, status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } },
    { $set: { status: 'RESOLVED', resolvedAt: new Date() } },
  );
}

async function saveUnavailable(device, reason, collectionStatus = 'blocked') {
  if (device.status !== 'UNKNOWN') {
    device.status = 'UNKNOWN';
    await device.save();
    getIO().emit('deviceUpdated', device.toJSON());
  }
  const metric = await Metric.create({
    device: device._id,
    metricSchemaVersion: 2,
    status: device.status,
    measurementSource: 'real',
    monitoringMode: 'real',
    availabilityStatus: 'unavailable',
    validity: 'unknown',
    collectionStatus,
    reasonUnavailable: reason,
    observationWindowStart: new Date(),
    observationWindowEnd: new Date(),
    cpuUtilization: null,
    memoryUtilization: null,
    incomingTraffic: null,
    outgoingTraffic: null,
    incomingThroughputBps: null,
    outgoingThroughputBps: null,
    derived: {
      unavailableMetrics: {
        deviceReachability: reason,
        cpuUtilization: 'No supported device-specific OID or authorized agent is configured',
        memoryUtilization: 'No supported device-specific OID or authorized agent is configured',
        inboundThroughput: reason,
        outboundThroughput: reason,
      },
    },
  });
  getIO().emit('metricAdded', metric);
  return metric;
}

async function processDevice(device, rateLimiter, localCounterSnapshot = null) {
  if (isEmergencyStopActive()) {
    await saveUnavailable(device, 'Emergency stop is active');
    return;
  }

  const allowlist = parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST);
  if (!simulationMode && !isTargetAllowed(device.ipAddress, allowlist)) {
    await saveUnavailable(device, 'Target is not in MONITORING_TARGET_ALLOWLIST');
    return;
  }

  const startedAt = Date.now();
  let reachable;
  let latency = null;
  let packetLoss = null;
  let rttMin = null;
  let rttMax = null;
  let rttStddev = null;
  let jitter = null;
  let cpuUtilization = null;
  let memoryUtilization = null;
  let incomingThroughputBps = null;
  let outgoingThroughputBps = null;
  let snmpData = null;
  let localInterface = null;
  let localInterfaceRates = null;
  let rawProbes = [];
  let collectionStatus = 'success';
  let reasonUnavailable = null;
  let availability = null;

  if (simulationMode) {
    reachable = Math.random() > 0.05;
    latency = reachable ? Math.floor(Math.random() * 50) + 10 : null;
    packetLoss = reachable ? Math.floor(Math.random() * 3) : 100;
    if (reachable && Math.random() > 0.95) latency = Math.floor(Math.random() * 200) + 100;
    cpuUtilization = reachable ? Math.floor(Math.random() * 40) + 10 : null;
    memoryUtilization = reachable ? Math.floor(Math.random() * 30) + 20 : null;
    incomingThroughputBps = reachable ? Math.floor(Math.random() * 100000) : null;
    outgoingThroughputBps = reachable ? Math.floor(Math.random() * 80000) : null;
    availability = reachable ? 100 : 0;
    collectionStatus = 'simulated';
  } else {
    const probe = await probeIcmp(device.ipAddress, {
      count: 5,
      timeout: 1,
      intervalMs: 250,
      beforeProbe: async () => {
        if (isEmergencyStopActive()) return false;
        await rateLimiter.acquire();
        return !isEmergencyStopActive();
      },
    });
    if (probe.cancelled && isEmergencyStopActive()) {
      await saveUnavailable(device, 'Emergency stop became active during polling');
      return;
    }

    reachable = probe.reachable;
    latency = probe.rttAvg;
    packetLoss = probe.error ? null : probe.packetLoss;
    rttMin = probe.rttMin;
    rttMax = probe.rttMax;
    rttStddev = probe.rttStddev;
    availability = probe.error ? null : probe.availability;
    rawProbes = probe.probes;
    if (probe.error) {
      collectionStatus = 'error';
      reasonUnavailable = 'One or more ICMP probes failed to execute';
    } else if (probe.probeCount === 0) {
      collectionStatus = 'timeout';
    }

    const stats = computeStats(rawProbes.filter((sample) => sample.success).map((sample) => sample.rttMs));
    if (stats.count > 1) {
      jitter = computeJitter(rawProbes).jitterAvg;
    }

    if (reachable && device.monitoringMethod === 'snmp' && !isEmergencyStopActive()) {
      snmpData = await collectSnmp(device);
      if (snmpData.supported) {
        incomingThroughputBps = snmpData.inBps ?? null;
        outgoingThroughputBps = snmpData.outBps ?? null;
        if (!snmpData.countersSupported) reasonUnavailable = snmpData.reason;
      } else {
        reasonUnavailable = snmpData.reason || 'SNMP telemetry is unavailable';
      }
    } else if (device.monitoringMethod === 'snmp') {
      reasonUnavailable = 'Device did not respond to ICMP; SNMP telemetry was not attempted';
    }

    localInterface = localCounterSnapshot?.interfaces.find(
      (entry) => entry.ipAddresses.includes(device.ipAddress),
    ) || null;
    if (localInterface) {
      const currentCounter = {
        ...localInterface,
        observedAt: localCounterSnapshot.observedAt,
      };
      const stateKey = `${device._id}:${localInterface.interfaceName}`;
      const previousCounter = localInterfaceCounterBaselines.get(stateKey);
      localInterfaceRates = previousCounter
        ? calculateInterfaceRates(previousCounter, currentCounter)
        : {
          incomingThroughputBps: null,
          outgoingThroughputBps: null,
          elapsedSeconds: null,
          inboundReason: 'Waiting for a second local interface-counter sample',
          outboundReason: 'Waiting for a second local interface-counter sample',
        };
      localInterfaceCounterBaselines.set(stateKey, currentCounter);

      if (!snmpData || (incomingThroughputBps === null && outgoingThroughputBps === null)) {
        incomingThroughputBps = localInterfaceRates.incomingThroughputBps;
        outgoingThroughputBps = localInterfaceRates.outgoingThroughputBps;
      }
    }
  }

  const useLocalInterfaceCounters = Boolean(
    localInterface
    && (!snmpData || (snmpData.inBps == null && snmpData.outBps == null)),
  );
  const trafficInterface = useLocalInterfaceCounters
    ? {
      interfaceId: `windows:${localInterface.interfaceName}`,
      source: 'windows-interface-counters',
      sourceProtocol: 'windows-netadapter',
      unit: 'bit/s',
      metadata: {
        interfaceName: localInterface.interfaceName,
        localIpAddress: device.ipAddress,
        elapsedSeconds: localInterfaceRates.elapsedSeconds,
        receivedBytes: localInterface.receivedBytes,
        sentBytes: localInterface.sentBytes,
      },
    }
    : snmpData?.ifIndex
      ? {
        interfaceId: `${snmpData.ifIndex}:${snmpData.interfaceName || 'unknown'}`,
        source: 'snmp-if-mib',
        sourceProtocol: 'snmp',
        unit: 'bit/s',
        metadata: { interfaceName: snmpData.interfaceName, interfaceIndex: snmpData.ifIndex },
      }
      : null;

  const previousStatus = device.status;
  let currentStatus = collectionStatus === 'error'
    ? (reachable ? 'UP' : 'UNKNOWN')
    : (reachable ? 'UP' : 'DOWN');
  if (reachable && (
    (latency !== null && latency >= thresholds.LATENCY_WARNING) ||
    (packetLoss !== null && packetLoss >= thresholds.PACKET_LOSS_WARNING)
  )) {
    currentStatus = 'WARNING';
  }

  device.status = currentStatus;
  if (reachable) device.lastSeen = new Date();
  await device.save();

  const endedAt = new Date();
  const unavailableMetrics = {};
  if (!simulationMode) {
    unavailableMetrics.cpuUtilization = 'No supported device-specific OID or authorized agent is configured';
    unavailableMetrics.memoryUtilization = 'No supported device-specific OID or authorized agent is configured';
    if (latency === null) unavailableMetrics.rtt = 'No successful ICMP round-trip sample was collected';
    if (packetLoss === null) unavailableMetrics.packetLoss = reasonUnavailable || 'No valid packet-loss measurement was collected';
    if (!snmpData) {
      unavailableMetrics.deviceUptime = 'SNMP is not configured for this device';
      unavailableMetrics.interfaceErrors = 'SNMP interface telemetry is not configured';
      unavailableMetrics.interfaceDrops = 'SNMP interface telemetry is not configured';
    } else {
      if (snmpData.sysUpTime === null) unavailableMetrics.deviceUptime = snmpData.reason || 'Device did not provide sysUpTime';
      if (snmpData.inErrors === null || snmpData.outErrors === null) unavailableMetrics.interfaceErrors = snmpData.reason || 'Interface error counters are unsupported';
      if (snmpData.inDiscards === null || snmpData.outDiscards === null) unavailableMetrics.interfaceDrops = snmpData.reason || 'Interface discard counters are unsupported';
    }
    const remoteInterfaceReason = snmpData?.reason
      || (device.monitoringMethod === 'snmp'
        ? 'Configure a supported SNMP community and interface index for this device'
        : 'No local interface has this device IP; configure SNMP interface counters for remote throughput');
    if (incomingThroughputBps === null) {
      unavailableMetrics.inboundThroughput = localInterfaceRates?.inboundReason || remoteInterfaceReason;
    }
    if (outgoingThroughputBps === null) {
      unavailableMetrics.outboundThroughput = localInterfaceRates?.outboundReason || remoteInterfaceReason;
    }
  }
  const metric = await Metric.create({
    device: device._id,
    metricSchemaVersion: 2,
    latency,
    rttMin,
    rttMax,
    rttStddev,
    jitter,
    packetLoss,
    availability,
    status: currentStatus,
    cpuUtilization,
    memoryUtilization,
    incomingTraffic: incomingThroughputBps,
    outgoingTraffic: outgoingThroughputBps,
    incomingThroughputBps,
    outgoingThroughputBps,
    inboundPacketRate: snmpData ? snmpData.inPacketsPerSecond ?? null : null,
    outboundPacketRate: snmpData ? snmpData.outPacketsPerSecond ?? null : null,
    interfaceId: trafficInterface?.interfaceId,
    source: trafficInterface?.source || (simulationMode ? 'simulation' : 'icmp'),
    sourceProtocol: trafficInterface?.sourceProtocol || (simulationMode ? 'simulation' : 'icmp'),
    unit: trafficInterface?.unit || (simulationMode ? 'bit/s' : undefined),
    collectionStatus,
    reasonUnavailable,
    measurementSource: simulationMode ? 'simulated' : 'real',
    monitoringMode: simulationMode ? 'simulation' : 'real',
    availabilityStatus: latency === null && packetLoss === null ? 'unavailable' : 'available',
    validity: collectionStatus === 'error' ? 'unknown' : 'valid',
    observationWindowStart: new Date(startedAt),
    observationWindowEnd: endedAt,
    sampleCount: rawProbes.length,
    snmp: snmpData,
    metadata: trafficInterface?.metadata,
    raw: rawProbes.length > 0 ? { probes: rawProbes } : undefined,
    derived: {
      pollingDurationMs: Date.now() - startedAt,
      inboundInterfaceErrors: snmpData ? snmpData.inErrors : null,
      outboundInterfaceErrors: snmpData ? snmpData.outErrors : null,
      inboundDroppedPackets: snmpData ? snmpData.inDiscards : null,
      outboundDroppedPackets: snmpData ? snmpData.outDiscards : null,
      interfaceSpeedBps: snmpData ? snmpData.interfaceSpeed : null,
      interfaceOperationalStatus: snmpData ? snmpData.operationalStatus : null,
      deviceUptimeSeconds: snmpData && snmpData.sysUpTime !== null ? snmpData.sysUpTime / 100 : null,
      inboundInterfaceUtilizationPercent: snmpData && snmpData.interfaceSpeed > 0 && incomingThroughputBps !== null
        ? (incomingThroughputBps / snmpData.interfaceSpeed) * 100
        : null,
      outboundInterfaceUtilizationPercent: snmpData && snmpData.interfaceSpeed > 0 && outgoingThroughputBps !== null
        ? (outgoingThroughputBps / snmpData.interfaceSpeed) * 100
        : null,
      unavailableMetrics,
      interface: trafficInterface?.metadata,
    },
  });

  if (currentStatus === 'DOWN') {
    await upsertAlert(device, 'DEVICE_DOWN', 'CRITICAL', `${device.name} is unreachable`);
  } else if (currentStatus === 'UP' || currentStatus === 'WARNING') {
    await resolveAlert(device, 'DEVICE_DOWN');
    if (previousStatus === 'DOWN') {
      const occurredAt = new Date();
      await Alert.create({
        device: device._id,
        type: 'DEVICE_RECOVERED',
        severity: 'LOW',
        message: `${device.name} has recovered`,
        status: 'RESOLVED',
        firstOccurredAt: occurredAt,
        lastOccurredAt: occurredAt,
        resolvedAt: occurredAt,
      });
    }
  }

  if (reachable && (
    (latency !== null && latency >= thresholds.LATENCY_CRITICAL) ||
    (packetLoss !== null && packetLoss >= thresholds.PACKET_LOSS_CRITICAL)
  )) {
    await upsertAlert(device, 'PERFORMANCE_DEGRADATION', 'HIGH', `${device.name} exceeded a critical latency or packet-loss threshold`);
  } else if (reachable && (
    (latency !== null && latency >= thresholds.LATENCY_WARNING) ||
    (packetLoss !== null && packetLoss >= thresholds.PACKET_LOSS_WARNING)
  )) {
    await upsertAlert(device, 'PERFORMANCE_DEGRADATION', 'MEDIUM', `${device.name} exceeded a warning latency or packet-loss threshold`);
  } else if (currentStatus !== 'UNKNOWN') {
    await resolveAlert(device, 'PERFORMANCE_DEGRADATION');
  }

  const publicDevice = device.toJSON();
  getIO().emit('deviceUpdated', publicDevice);
  getIO().emit('metricAdded', metric);
}

function startMonitoring() {
  if (monitoringStarted) {
    console.log('Monitoring engine already started; skipping duplicate scheduler');
    return;
  }
  monitoringStarted = true;
  const concurrency = boundedInteger(process.env.MONITORING_MAX_CONCURRENCY, DEFAULT_CONCURRENCY, 1, 10);
  const maxProbesPerSecond = boundedInteger(process.env.MONITORING_MAX_PROBES_PER_SECOND, DEFAULT_MAX_PROBES_PER_SECOND, 1, 10);
  const semaphore = new Semaphore(concurrency);
  const rateLimiter = createRateLimiter({ maxPerSecond: maxProbesPerSecond });

  const runCycle = async () => {
    try {
      await updateSettingsCache();
      if (isEmergencyStopActive()) {
        console.warn('Emergency stop is active; skipping monitoring cycle');
        return;
      }

      const now = Date.now();
      const devices = await Device.find({ monitoringStatus: true });
      const dueDevices = devices.filter((device) => {
        const previousPoll = lastPolledAt.get(String(device._id)) || 0;
        if (!isDeviceDueForPolling(device, now, previousPoll) || isEmergencyStopActive()) return false;
        lastPolledAt.set(String(device._id), now);
        return true;
      });

      let localCounterSnapshot = null;
      const hasAuthorizedTargets = dueDevices.some((device) => (
        isTargetAllowed(device.ipAddress, parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST))
      ));
      if (!simulationMode && process.platform === 'win32' && hasAuthorizedTargets) {
        try {
          localCounterSnapshot = await readWindowsInterfaceCounters();
        } catch (error) {
          console.error('Local Windows interface-counter collection failed:', error.message);
        }
      }

      await Promise.all(dueDevices.map(async (device) => {
        const release = await semaphore.acquire();
        try {
          if (!isEmergencyStopActive()) {
            await processDevice(device, rateLimiter, localCounterSnapshot);
          }
        } finally {
          release();
        }
      }));
    } catch (error) {
      console.error('Monitoring cycle failed:', error);
    }
  };

  monitoringTask = cron.schedule(`*/${POLL_INTERVAL_SECONDS} * * * * *`, () => {
    if (cycleRunning) return;
    cycleRunning = true;
    currentCyclePromise = runCycle().finally(() => {
      cycleRunning = false;
      currentCyclePromise = null;
    });
    return currentCyclePromise;
  });
  console.log('Monitoring engine started');
}

async function stopMonitoring() {
  if (monitoringTask) monitoringTask.stop();
  monitoringTask = null;
  monitoringStarted = false;
  if (currentCyclePromise) await currentCyclePromise;
}

module.exports = { startMonitoring, stopMonitoring, processDevice, updateSettingsCache };
