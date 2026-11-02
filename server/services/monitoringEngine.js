const cron = require('node-cron');
const snmp = require('net-snmp');
const Device = require('../models/Device');
const Collector = require('../models/Collector');
const Subnet = require('../models/Subnet');
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
  parseAllowlist,
  getApprovedSubnetDiscoveryHosts,
  setEmergencyStop,
  isEmergencyStopActive,
} = require('../utils/networkSafety');
const {
  HARDWARE_OIDS,
  createSnmpSession,
  collectHardwareTables,
  parseHardwareVarbinds,
} = require('../utils/snmpHardwareCollectors');
const { calculateOverallHealthScore } = require('../utils/healthScoreEngine');
const { authorizeMonitoringDevice } = require('../utils/subnetAuthorization');
const { runDiscoveryForSubnet } = require('./discoveryService');
const { synchronizeConnectedInterfaces, isFreshInterfaceAuthorization } = require('./interfaceAuthorizationService');
const {
  getNetworkAuthorizationPolicy,
  getEffectiveDiscoveryAuthorizationMode,
} = require('../utils/networkAuthorizationPolicy');
const { transitionDeviceHealth } = require('../utils/deviceHealthState');

const telemetryTestTimes = new Map();
const SNMP_TEST_COOLDOWN_MS = 60_000;
let telemetryTestInProgress = false;
let lastTelemetryTestStartedAt = 0;
const diagnosticRateLimiter = createRateLimiter({ maxPerSecond: 1 });

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
let discoveryTask = null;
let interfaceAuthorizationTask = null;
let currentCyclePromise = null;
let scheduledDiscoveryRunning = false;
let thresholds = {
  LATENCY_WARNING: 100,
  LATENCY_CRITICAL: 250,
  PACKET_LOSS_WARNING: 5,
  PACKET_LOSS_CRITICAL: 15,
  CPU_WARNING: 80,
  CPU_CRITICAL: 95,
  MEMORY_WARNING: 85,
  MEMORY_CRITICAL: 95,
  INTERFACE_UTILIZATION_WARNING: 80,
  INTERFACE_UTILIZATION_CRITICAL: 90,
  HEALTH_CRITICAL: 50,
  DEVICE_DOWN_FAILURE_THRESHOLD: 3,
  DEVICE_UP_RECOVERY_THRESHOLD: 2,
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

function exactCounterValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value) && value.length === 8) return value.readBigUInt64BE().toString();
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
}

function classifySnmpError(error) {
  if (error?.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_MISSING'
    || error?.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_INVALID'
    || error?.code === 'SNMP_CREDENTIAL_CIPHERTEXT_INVALID') {
    return 'CREDENTIAL_CONFIGURATION_ERROR';
  }
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('timeout') || message.includes('timed out')) return 'TIMEOUT';
  if (message.includes('auth') || message.includes('usm')) return 'AUTHENTICATION_FAILED';
  if (message.includes('nosuchname') || message.includes('no such name')) return 'UNSUPPORTED';
  return 'COLLECTION_ERROR';
}

function metricIdForOid(oid) {
  if (oid === HARDWARE_OIDS.sysUpTime) return 'device_uptime';
  if (oid.startsWith('1.3.6.1.4.1.2021.11.') || oid.startsWith('1.3.6.1.4.1.9.9.109.')) return 'cpu_utilization';
  if (oid.startsWith('1.3.6.1.4.1.2021.4.')) return 'memory_utilization';
  if (oid.startsWith('1.3.6.1.4.1.9.9.13.')) return 'temperature';

  const ifMibColumn = oid.match(/^1\.3\.6\.1\.2\.1\.2\.2\.1\.(\d+)\.\d+$/)?.[1];
  const highCapacityColumn = oid.match(/^1\.3\.6\.1\.2\.1\.31\.1\.1\.1\.(\d+)\.\d+$/)?.[1];
  const column = highCapacityColumn || ifMibColumn;
  const metricByColumn = {
    5: 'interface_speed',
    6: 'inbound_throughput',
    7: 'inbound_packet_rate',
    8: 'interface_operational_status',
    10: highCapacityColumn ? 'outbound_throughput' : 'inbound_throughput',
    11: highCapacityColumn ? 'outbound_packet_rate' : 'inbound_packet_rate',
    13: 'inbound_dropped_packets',
    14: 'inbound_interface_errors',
    15: 'interface_speed',
    16: 'outbound_throughput',
    17: 'outbound_packet_rate',
    19: 'outbound_dropped_packets',
    20: 'outbound_interface_errors',
  };
  return metricByColumn[column] || 'interface_telemetry';
}

async function collectSnmp(device, options = {}) {
  if (device.snmpVersion === '3') {
    const level = device.snmpSecurityLevel || 'noAuthNoPriv';
    if (!device.snmpSecurityName ||
      (level !== 'noAuthNoPriv' && !device.snmpAuthKey) ||
      (level === 'authPriv' && !device.snmpPrivKey)) {
      return {
        supported: false,
        responded: false,
        errorCode: 'NOT_CONFIGURED',
        reason: 'SNMPv3 security name and required authentication/privacy keys are not configured',
      };
    }
  } else if (!device.snmpCommunity) {
    return {
      supported: false,
      responded: false,
      errorCode: 'NOT_CONFIGURED',
      reason: 'SNMP community is not configured',
    };
  }

  const ifIndex = Number(device.snmpInterfaceIndex);
  const oids = [
    HARDWARE_OIDS.sysDescr,
    HARDWARE_OIDS.sysUpTime,
    HARDWARE_OIDS.sysName,
  ];
  if (device.snmpVersion !== '1') {
    oids.push(
      HARDWARE_OIDS.ucdCpuIdle,
      HARDWARE_OIDS.ciscoCpu5Min,
      HARDWARE_OIDS.ciscoCpuAvgBusy5,
      HARDWARE_OIDS.ucdMemTotalReal,
      HARDWARE_OIDS.ucdMemAvailReal,
    );
  }
  if (Number.isInteger(ifIndex) && ifIndex > 0) {
    if (device.snmpVersion !== '1') {
      oids.push(
        `1.3.6.1.2.1.31.1.1.1.6.${ifIndex}`,
        `1.3.6.1.2.1.31.1.1.1.10.${ifIndex}`,
        `1.3.6.1.2.1.31.1.1.1.7.${ifIndex}`,
        `1.3.6.1.2.1.31.1.1.1.11.${ifIndex}`,
        `1.3.6.1.2.1.31.1.1.1.15.${ifIndex}`,
      );
    }
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

  let session;
  try {
    session = createSnmpSession(device, { timeout: 1500, retries: 0 });
  } catch (error) {
    const errorCode = classifySnmpError(error);
    return {
      supported: true,
      responded: false,
      errorCode,
      reason: errorCode === 'CREDENTIAL_CONFIGURATION_ERROR'
        ? 'SNMP credential encryption configuration or stored credential format is invalid'
        : 'Unable to initialize the configured SNMP session',
      oidChecks: [{
        oid: HARDWARE_OIDS.sysUpTime,
        metricId: 'device_uptime',
        snmpVersion: device.snmpVersion || '2c',
        collectedAt: new Date(),
        responseStatus: errorCode,
        value: null,
        unit: 'tim-ticks',
        reason: 'Unable to initialize the configured SNMP session',
        deviceId: String(device._id),
        interfaceId: null,
      }],
    };
  }
  const deviceId = String(device._id);

  await options.beforeRequest?.();
  const collectedAt = new Date();
  const result = await new Promise((resolve) => {
    session.get(oids, (error, varbinds) => {
      if (error) {
        session.close();
        const errorCode = classifySnmpError(error);
        const reason = errorCode === 'TIMEOUT'
          ? 'SNMP agent did not respond before the request timeout'
          : errorCode === 'AUTHENTICATION_FAILED'
            ? 'SNMP authentication failed; verify the configured security credentials'
            : 'SNMP collection failed';
        resolve({
          supported: true,
          responded: errorCode === 'UNSUPPORTED',
          errorCode,
          reason: errorCode === 'UNSUPPORTED'
            ? 'The SNMP agent responded, but one or more requested OIDs are unsupported'
            : reason,
          oidChecks: oids.map((oid) => ({
            oid,
            metricId: metricIdForOid(oid),
            snmpVersion: device.snmpVersion || '2c',
            collectedAt,
            responseStatus: errorCode,
            value: null,
            unit: oid === '1.3.6.1.2.1.1.3.0' ? 'tim-ticks' : null,
            reason: errorCode === 'UNSUPPORTED'
              ? 'SNMPv1 request included an unsupported OID'
              : reason,
            deviceId,
            interfaceId: Number.isInteger(ifIndex) && ifIndex > 0 ? String(ifIndex) : null,
          })),
        });
        return;
      }

      const processResponse = async () => {
      const values = {};
      let interfaceName = null;
      let unsupported = false;
      let highCapacityUnsupported = false;
      const oidChecks = [];
      for (const varbind of varbinds) {
        const isError = snmp.isVarbindError(varbind);
        const oid = varbind.oid;
        const isHighSpeed = oid === `1.3.6.1.2.1.31.1.1.1.15.${ifIndex}`;
        const check = {
          oid,
          metricId: metricIdForOid(oid),
          snmpVersion: device.snmpVersion || '2c',
          collectedAt,
          responseStatus: isError ? 'UNSUPPORTED' : 'AVAILABLE',
          value: null,
          unit: oid === '1.3.6.1.2.1.1.3.0'
            ? 'tim-ticks'
            : isHighSpeed
              ? 'Mbit/s'
              : oid.startsWith('1.3.6.1.4.1.2021.11.') || oid.startsWith('1.3.6.1.4.1.9.9.109.')
                ? '%'
                : oid.startsWith('1.3.6.1.4.1.2021.4.')
                  ? 'kB'
                  : oid.includes('.1.10.') || oid.includes('.1.16.')
                ? 'octets'
                : oid.includes('.1.14.') || oid.includes('.1.20.')
                  ? 'errors'
                  : oid.includes('.1.13.') || oid.includes('.1.19.')
                    ? 'packets'
                    : null,
          reason: isError ? 'The device does not expose this OID for the configured interface' : null,
          deviceId,
          interfaceId: Number.isInteger(ifIndex) && ifIndex > 0 ? String(ifIndex) : null,
        };
        if (isError) {
          oidChecks.push(check);
          if (varbind.oid.startsWith('1.3.6.1.2.1.31.1.1.1.')) highCapacityUnsupported = true;
          else unsupported = true;
          continue;
        }
        if (varbind.oid === `1.3.6.1.2.1.2.2.1.2.${ifIndex}`) {
          interfaceName = String(varbind.value);
        } else {
          values[varbind.oid] = varbind.oid.startsWith('1.3.6.1.2.1.31.1.1.1.')
            ? exactCounterValue(varbind.value)
            : numericValue(varbind.value);
        }
        check.value = values[varbind.oid] ?? String(varbind.value);
        oidChecks.push(check);
      }

      const read = (suffix) => values[`1.3.6.1.2.1.2.2.1.${suffix}.${ifIndex}`] ?? null;
      const readHighCapacity = (suffix) => values[`1.3.6.1.2.1.31.1.1.1.${suffix}.${ifIndex}`] ?? null;
      const inOctetsHC = readHighCapacity(6);
      const outOctetsHC = readHighCapacity(10);
      const inPacketsHC = readHighCapacity(7);
      const outPacketsHC = readHighCapacity(11);
      const inOctets = inOctetsHC === null ? read(10) : Number(inOctetsHC);
      const outOctets = outOctetsHC === null ? read(16) : Number(outOctetsHC);
      const data = {
        supported: true,
        responded: true,
        sysUpTime: values['1.3.6.1.2.1.1.3.0'] ?? null,
        ifIndex: Number.isInteger(ifIndex) && ifIndex > 0 ? ifIndex : null,
        interfaceName,
        inOctets,
        outOctets,
        inOctetsHC,
        outOctetsHC,
        inPackets: inPacketsHC === null ? read(11) : Number(inPacketsHC),
        outPackets: outPacketsHC === null ? read(17) : Number(outPacketsHC),
        inPacketsHC,
        outPacketsHC,
        inErrors: read(14),
        outErrors: read(20),
        inDiscards: read(13),
        outDiscards: read(19),
        interfaceSpeed: (read(5) > 0 ? read(5) : null)
          ?? (readHighCapacity(15) > 0 ? readHighCapacity(15) * 1_000_000 : null),
        interfaceHighSpeedMbps: readHighCapacity(15),
        operationalStatus: read(8),
        countersSupported: Number.isInteger(ifIndex) && ifIndex > 0
          && inOctets !== null && outOctets !== null && !unsupported,
        highCapacitySupported: !highCapacityUnsupported
          && (inOctetsHC !== null || outOctetsHC !== null),
        oidChecks,
      };
      if (!data.ifIndex) data.reason = 'Configure an interface index to collect interface counters';
      else if (unsupported) data.reason = 'One or more requested interface counters are unsupported';
      else if (highCapacityUnsupported) data.reason = 'High-capacity counters are unsupported; standard interface counters are used';
      else if (data.inOctets !== null && data.outOctets !== null) {
        data.reason = 'Waiting for a second SNMP interface-counter sample';
      }
      const hardwareTables = await collectHardwareTables(session, options.beforeRequest);
      const hardware = parseHardwareVarbinds([...varbinds, ...hardwareTables.varbinds]);
      data.hardware = hardware;
      const tableMetrics = [
        {
          metricId: 'cpu_utilization',
          oid: HARDWARE_OIDS.hrProcessorLoadTable,
          value: hardware.cpu.source === 'host-resources-processor' ? hardware.cpu.utilization : null,
          unit: '%',
          available: hardware.cpu.source === 'host-resources-processor',
          reason: hardware.cpu.reason,
        },
        {
          metricId: 'cpu_utilization',
          oid: HARDWARE_OIDS.ciscoCpu5MinTable,
          value: hardware.cpu.source === 'cisco-cpm' ? hardware.cpu.utilization : null,
          unit: '%',
          available: hardware.cpu.source === 'cisco-cpm',
          reason: hardware.cpu.reason,
        },
        {
          metricId: 'memory_utilization',
          oid: '1.3.6.1.2.1.25.2.3.1',
          value: hardware.memory.utilization,
          unit: '%',
          available: hardware.memory.utilization !== null,
          reason: hardware.memory.reason,
        },
        {
          metricId: 'temperature',
          oid: '1.3.6.1.4.1.9.9.13.1.3.1',
          value: hardware.temperature.celsius,
          unit: '°C',
          available: hardware.temperature.celsius !== null,
          reason: hardware.temperature.reason,
        },
      ];
      for (const check of tableMetrics) {
        const table = hardwareTables.checks.find((entry) => entry.oid === check.oid);
        oidChecks.push({
          metricId: check.metricId,
          oid: check.oid,
          snmpVersion: device.snmpVersion || '2c',
          collectedAt,
          responseStatus: check.available ? 'AVAILABLE' : table?.error
            ? classifySnmpError(table.error)
            : 'UNSUPPORTED',
          value: check.value,
          unit: check.unit,
          reason: check.available ? null : check.reason,
          deviceId,
          interfaceId: null,
        });
      }
      data.oidChecks = oidChecks;
      session.close();
      return data;
      };
      processResponse().then(resolve).catch((error) => {
        session.close();
        resolve({
          supported: true,
          responded: true,
          errorCode: 'COLLECTION_ERROR',
          reason: 'SNMP response processing failed',
          oidChecks: [{
            oid: '1.3.6.1.2.1.1.3.0',
            metricId: 'device_uptime',
            snmpVersion: device.snmpVersion || '2c',
            collectedAt,
            responseStatus: 'COLLECTION_ERROR',
            value: null,
            unit: 'tim-ticks',
            reason: 'SNMP response processing failed',
            deviceId,
            interfaceId: null,
          }],
        });
      });
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
    const previousInOctets = previous.inOctetsHC ?? previous.inOctets;
    const previousOutOctets = previous.outOctetsHC ?? previous.outOctets;
    const currentInOctets = result.inOctetsHC ?? result.inOctets;
    const currentOutOctets = result.outOctetsHC ?? result.outOctets;
    const inCounterWidth = result.inOctetsHC !== null ? 64 : 32;
    const outCounterWidth = result.outOctetsHC !== null ? 64 : 32;
    const inDelta = previous.inCounterWidth === inCounterWidth
      ? computeCounterDelta(previousInOctets, currentInOctets, elapsedSeconds, inCounterWidth)
      : null;
    const outDelta = previous.outCounterWidth === outCounterWidth
      ? computeCounterDelta(previousOutOctets, currentOutOctets, elapsedSeconds, outCounterWidth)
      : null;
    const inPacketDelta = computeCounterDelta(
      previous.inPacketsHC ?? previous.inPackets,
      result.inPacketsHC ?? result.inPackets,
      elapsedSeconds,
      result.inPacketsHC !== null ? 64 : 32,
    );
    const outPacketDelta = computeCounterDelta(
      previous.outPacketsHC ?? previous.outPackets,
      result.outPacketsHC ?? result.outPackets,
      elapsedSeconds,
      result.outPacketsHC !== null ? 64 : 32,
    );
    result.elapsedSeconds = elapsedSeconds;
    result.inDelta = inDelta;
    result.outDelta = outDelta;
    result.inBps = computeThroughputBps(inDelta, elapsedSeconds);
    result.outBps = computeThroughputBps(outDelta, elapsedSeconds);
    result.inPacketsPerSecond = inPacketDelta === null ? null : inPacketDelta / elapsedSeconds;
    result.outPacketsPerSecond = outPacketDelta === null ? null : outPacketDelta / elapsedSeconds;
    result.counterReset = (
      inDelta === null && previousInOctets !== null && currentInOctets !== null
      && BigInt(currentInOctets) < BigInt(previousInOctets)
    ) || (
      outDelta === null && previousOutOctets !== null && currentOutOctets !== null
      && BigInt(currentOutOctets) < BigInt(previousOutOctets)
    );
    if (result.inBps !== null && result.outBps !== null) result.reason = null;
  }

  snmpState.set(stateKey, {
    inOctets: result.inOctetsHC === null ? result.inOctets : null,
    outOctets: result.outOctetsHC === null ? result.outOctets : null,
    inOctetsHC: result.inOctetsHC,
    outOctetsHC: result.outOctetsHC,
    inPackets: result.inPacketsHC === null ? result.inPackets : null,
    outPackets: result.outPacketsHC === null ? result.outPackets : null,
    inPacketsHC: result.inPacketsHC,
    outPacketsHC: result.outPacketsHC,
    inCounterWidth: result.inOctetsHC !== null ? 64 : 32,
    outCounterWidth: result.outOctetsHC !== null ? 64 : 32,
    timestamp: now,
  });
  return result;
}

async function testDeviceTelemetry(device) {
  const [simulationSetting, emergencySetting, networkPolicySetting] = await Promise.all([
    Setting.findOne({ key: 'SIMULATION_MODE' }),
    Setting.findOne({ key: 'EMERGENCY_STOP' }),
    Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
  ]);
  if (isEnabled(emergencySetting?.value, false) || isEmergencyStopActive()) {
    return { errorCode: 'EMERGENCY_STOP', message: 'Telemetry diagnostics are disabled while emergency stop is active' };
  }
  if (isEnabled(simulationSetting?.value, true)) {
    return { errorCode: 'SIMULATION_MODE', message: 'Disable simulation mode before testing live device telemetry' };
  }
  const approvedSubnets = await Subnet.find({
    status: 'active',
    approvalStatus: 'approved',
  }).lean();
  const networkAuthorizationPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
  const authorization = authorizeMonitoringDevice(
    device,
    approvedSubnets,
    parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST),
    {
      authorizationMode: networkAuthorizationPolicy.mode,
      autoAuthorizeInterfaces: networkAuthorizationPolicy.autoAuthorizeInterfaces,
    },
  );
  if (!authorization.authorized) {
    return { errorCode: authorization.code, message: authorization.reason };
  }
  if (device.monitoringMethod !== 'snmp') {
    return { errorCode: 'NOT_CONFIGURED', message: 'SNMP is not selected for this device' };
  }

  const key = String(device._id);
  const now = Date.now();
  if (telemetryTestInProgress || now - lastTelemetryTestStartedAt < 1_000) {
    return { errorCode: 'TEST_BUSY', message: 'Another telemetry diagnostic is already running' };
  }
  const lastTestAt = telemetryTestTimes.get(key);
  if (lastTestAt !== undefined && now - lastTestAt < SNMP_TEST_COOLDOWN_MS) {
    return { errorCode: 'COOLDOWN', message: 'Wait before running another diagnostic for this device' };
  }

  telemetryTestInProgress = true;
  lastTelemetryTestStartedAt = now;
  telemetryTestTimes.set(key, now);
  const startedAt = Date.now();
  try {
    let snmpData;
    try {
      snmpData = await collectSnmp(device, { beforeRequest: () => diagnosticRateLimiter.acquire() });
    } catch (error) {
      const errorCode = classifySnmpError(error);
      return {
        deviceId: key,
        snmpVersion: device.snmpVersion || '2c',
        status: errorCode,
        reason: 'SNMP collection failed',
        collectedAt: new Date(),
        collectionDurationMs: Date.now() - startedAt,
        snmp: { errorCode, responded: false, oidChecks: [] },
      };
    }
    return {
      deviceId: key,
      snmpVersion: device.snmpVersion || '2c',
      status: snmpData.responded ? 'AVAILABLE' : (snmpData.errorCode || 'UNAVAILABLE'),
      reason: snmpData.reason || null,
      collectedAt: new Date(),
      collectionDurationMs: Date.now() - startedAt,
      snmp: snmpData,
    };
  } finally {
    telemetryTestInProgress = false;
  }
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
  const stateChanged = device.status !== 'UNKNOWN'
    || device.consecutiveFailureCount !== 0
    || device.consecutiveRecoveryCount !== 0;
  if (stateChanged) {
    device.status = 'UNKNOWN';
    device.consecutiveFailureCount = 0;
    device.consecutiveRecoveryCount = 0;
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

async function processDevice(
  device,
  rateLimiter,
  localCounterSnapshot = null,
  approvedSubnets = null,
  networkAuthorizationMode = 'legacy_allowlists',
  autoAuthorizeInterfaces = false,
) {
  if (isEmergencyStopActive()) {
    await saveUnavailable(device, 'Emergency stop is active');
    return;
  }

  const allowlist = parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST);
  if (!simulationMode) {
    const activeSubnets = approvedSubnets || await Subnet.find({
      status: 'active',
      approvalStatus: 'approved',
    }).lean();
    const authorization = authorizeMonitoringDevice(
      device,
      activeSubnets,
      allowlist,
      { authorizationMode: networkAuthorizationMode, autoAuthorizeInterfaces },
    );
    if (!authorization.authorized) {
      await saveUnavailable(device, authorization.reason);
      return;
    }
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

    if (device.monitoringMethod === 'snmp' && !isEmergencyStopActive()) {
      try {
        snmpData = await collectSnmp(device, { beforeRequest: () => rateLimiter.acquire() });
      } catch (error) {
        const errorCode = classifySnmpError(error);
        console.error(`SNMP collection failed for device ${device._id}: ${errorCode}`);
        snmpData = {
          supported: true,
          responded: false,
          errorCode,
          reason: 'SNMP collection failed',
        };
      }
      if (snmpData.responded) reachable = true;
      cpuUtilization = snmpData.hardware?.cpu?.utilization ?? null;
      memoryUtilization = snmpData.hardware?.memory?.utilization ?? null;
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

  const previousStatus = device.status || 'UNKNOWN';
  const degraded = reachable && (
    (latency !== null && latency >= thresholds.LATENCY_WARNING) ||
    (packetLoss !== null && packetLoss >= thresholds.PACKET_LOSS_WARNING)
  );
  const currentStatus = transitionDeviceHealth(device, {
    reachable,
    degraded,
    collectionError: collectionStatus === 'error' && !reachable,
  }, {
    failureThreshold: thresholds.DEVICE_DOWN_FAILURE_THRESHOLD,
    recoveryThreshold: thresholds.DEVICE_UP_RECOVERY_THRESHOLD,
  });

  // Calculate device health score components
  const healthResult = calculateOverallHealthScore({
    deviceStatus: currentStatus,
    availabilityPercent: availability,
    latency,
    packetLoss,
    jitter,
    inBps: incomingThroughputBps,
    outBps: outgoingThroughputBps,
    speedBps: snmpData ? snmpData.interfaceSpeed : null,
    inErrors: snmpData ? snmpData.inErrors : null,
    outErrors: snmpData ? snmpData.outErrors : null,
    inDiscards: snmpData ? snmpData.inDiscards : null,
    outDiscards: snmpData ? snmpData.outDiscards : null,
    cpuUtilization,
    memoryUtilization,
    temperatureCelsius: snmpData?.hardware?.temperature?.celsius ?? null,
    temperatureThreshold: snmpData?.hardware?.temperature?.thresholdCelsius ?? null,
  });

  device.status = currentStatus;
  device.healthScore = healthResult.overallScore;
  device.healthStatus = healthResult.healthStatus;
  if (reachable) device.lastSeen = new Date();
  await device.save();

  const endedAt = new Date();
  const unavailableMetrics = {};
  const hardwareStatus = (metricId, value) => {
    if (simulationMode) return 'SIMULATED';
    if (value !== null && value !== undefined) return 'AVAILABLE';
    const failedCheck = snmpData?.oidChecks?.find((check) => (
      check.metricId === metricId
      && ['AUTHENTICATION_FAILED', 'TIMEOUT', 'COLLECTION_ERROR'].includes(check.responseStatus)
    ));
    return failedCheck?.responseStatus || snmpData?.errorCode || 'UNSUPPORTED';
  };
  if (!simulationMode) {
    if (cpuUtilization === null) {
      unavailableMetrics.cpuUtilization = snmpData?.hardware?.cpu?.reason
        || snmpData?.reason
        || 'No supported CPU OID or authorized host agent is available';
    }
    if (memoryUtilization === null) {
      unavailableMetrics.memoryUtilization = snmpData?.hardware?.memory?.reason
        || snmpData?.reason
        || 'No supported physical-memory OID or authorized host agent is available';
    }
    if (snmpData?.hardware?.temperature?.celsius == null) {
      unavailableMetrics.temperature = snmpData?.hardware?.temperature?.reason
        || (!snmpData ? 'SNMP is not configured for this device' : null)
        || 'No supported environmental sensor OID responded';
    }
    if (latency === null) unavailableMetrics.rtt = 'No successful ICMP round-trip sample was collected';
    if (packetLoss === null) unavailableMetrics.packetLoss = reasonUnavailable || 'No valid packet-loss measurement was collected';
    if (!snmpData) {
      unavailableMetrics.deviceUptime = 'SNMP is not configured for this device';
      unavailableMetrics.interfaceErrors = 'SNMP interface telemetry is not configured';
      unavailableMetrics.interfaceDrops = 'SNMP interface telemetry is not configured';
    } else {
      if (snmpData.sysUpTime == null) unavailableMetrics.deviceUptime = snmpData.reason || 'Device did not provide sysUpTime';
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
    availabilityStatus: latency === null && packetLoss === null && !snmpData?.responded
      ? 'unavailable'
      : 'available',
    validity: collectionStatus === 'error' ? 'unknown' : 'valid',
    observationWindowStart: new Date(startedAt),
    observationWindowEnd: endedAt,
    sampleCount: rawProbes.length,
    snmp: snmpData,
    hardware: {
      cpu: {
        utilization: cpuUtilization,
        load: snmpData?.hardware?.cpu?.load ?? null,
        perCore: snmpData?.hardware?.cpu?.perCore || [],
        source: simulationMode ? 'simulation' : snmpData?.hardware?.cpu?.source || null,
        reason: simulationMode
          ? 'Simulated value; not measured from this device'
          : unavailableMetrics.cpuUtilization || null,
      },
      memory: {
        utilization: memoryUtilization,
        totalBytes: snmpData?.hardware?.memory?.totalBytes ?? null,
        usedBytes: snmpData?.hardware?.memory?.usedBytes ?? null,
        freeBytes: snmpData?.hardware?.memory?.freeBytes ?? null,
        source: simulationMode ? 'simulation' : snmpData?.hardware?.memory?.source || null,
        reason: simulationMode
          ? 'Simulated value; not measured from this device'
          : unavailableMetrics.memoryUtilization || null,
      },
      system: {
        sysDescr: snmpData?.hardware?.system?.sysDescr ?? null,
        sysUpTime: snmpData?.sysUpTime ?? null,
        sysName: snmpData?.hardware?.system?.sysName ?? null,
        sysLocation: snmpData?.hardware?.system?.sysLocation ?? null,
      },
      temperature: {
        celsius: snmpData?.hardware?.temperature?.celsius ?? null,
        thresholdCelsius: snmpData?.hardware?.temperature?.thresholdCelsius ?? null,
        source: simulationMode ? null : snmpData?.hardware?.temperature?.source || null,
        reason: simulationMode
          ? 'Temperature is not simulated or measured'
          : unavailableMetrics.temperature || null,
      },
      availability: {
        cpu: hardwareStatus('cpu_utilization', cpuUtilization),
        memory: hardwareStatus('memory_utilization', memoryUtilization),
        temperature: simulationMode ? 'UNSUPPORTED'
          : hardwareStatus('temperature', snmpData?.hardware?.temperature?.celsius),
        uptime: simulationMode ? 'UNSUPPORTED'
          : hardwareStatus('device_uptime', snmpData?.sysUpTime),
      },
    },
    telemetryChecks: snmpData?.oidChecks || [],
    health: healthResult,
    reachability: {
      confirmedMethod: snmpData?.responded ? 'snmp' : (reachable ? 'icmp' : 'none'),
      isReachable: Boolean(reachable),
      methodsChecked: [device.monitoringMethod === 'snmp' ? 'snmp' : 'icmp'],
      methodsResponding: reachable ? [snmpData?.responded ? 'snmp' : 'icmp'] : [],
      reason: reachable ? `Reachable via ${snmpData?.responded ? 'SNMP' : 'ICMP'}` : 'Unreachable',
    },
    metadata: trafficInterface?.metadata,
    raw: rawProbes.length > 0 ? { probes: rawProbes } : undefined,
    derived: {
      pollingDurationMs: Date.now() - startedAt,
      inboundInterfaceErrors: snmpData ? snmpData.inErrors : null,
      outboundInterfaceErrors: snmpData ? snmpData.outErrors : null,
      inboundDroppedPackets: snmpData ? snmpData.inDiscards : null,
      outboundDroppedPackets: snmpData ? snmpData.outDiscards : null,
      interfaceSpeedBps: snmpData ? snmpData.interfaceSpeed : null,
      interfaceHighSpeedMbps: snmpData ? snmpData.interfaceHighSpeedMbps : null,
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

  // 1. Device Offline / Recovered Alerts
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

  // 2. Latency / Packet Loss Alerts
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

  // 3. High CPU Alerts
  if (reachable && cpuUtilization !== null && cpuUtilization >= thresholds.CPU_CRITICAL) {
    await upsertAlert(device, 'HIGH_CPU', 'CRITICAL', `${device.name} CPU utilization is critical at ${cpuUtilization}%`);
  } else if (reachable && cpuUtilization !== null && cpuUtilization >= thresholds.CPU_WARNING) {
    await upsertAlert(device, 'HIGH_CPU', 'HIGH', `${device.name} CPU utilization is elevated at ${cpuUtilization}%`);
  } else if (currentStatus !== 'UNKNOWN' && cpuUtilization !== null) {
    await resolveAlert(device, 'HIGH_CPU');
  }

  // 4. High Memory Alerts
  if (reachable && memoryUtilization !== null && memoryUtilization >= thresholds.MEMORY_CRITICAL) {
    await upsertAlert(device, 'HIGH_MEMORY', 'CRITICAL', `${device.name} memory utilization is critical at ${memoryUtilization}%`);
  } else if (reachable && memoryUtilization !== null && memoryUtilization >= thresholds.MEMORY_WARNING) {
    await upsertAlert(device, 'HIGH_MEMORY', 'HIGH', `${device.name} memory utilization is elevated at ${memoryUtilization}%`);
  } else if (currentStatus !== 'UNKNOWN' && memoryUtilization !== null) {
    await resolveAlert(device, 'HIGH_MEMORY');
  }

  // 5. Interface Errors
  if (reachable && snmpData && ((snmpData.inErrors || 0) > 0 || (snmpData.outErrors || 0) > 0)) {
    await upsertAlert(device, 'INTERFACE_ERRORS', 'MEDIUM', `${device.name} detected interface errors (In: ${snmpData.inErrors || 0}, Out: ${snmpData.outErrors || 0})`);
  } else if (currentStatus !== 'UNKNOWN' && snmpData && snmpData.inErrors === 0 && snmpData.outErrors === 0) {
    await resolveAlert(device, 'INTERFACE_ERRORS');
  }

  // 6. Critical Device Health Alerts
  if (reachable && healthResult.overallScore !== null && healthResult.overallScore < thresholds.HEALTH_CRITICAL) {
    await upsertAlert(device, 'CRITICAL_DEVICE_HEALTH', 'CRITICAL', `${device.name} overall health score is critical (${healthResult.overallScore}/100)`);
  } else if (currentStatus !== 'UNKNOWN' && healthResult.overallScore !== null && healthResult.overallScore >= thresholds.HEALTH_CRITICAL) {
    await resolveAlert(device, 'CRITICAL_DEVICE_HEALTH');
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

  const runScheduledDiscovery = async () => {
    if (scheduledDiscoveryRunning || simulationMode || isEmergencyStopActive()) return;
    scheduledDiscoveryRunning = true;
    try {
      const dueSubnets = await Subnet.find({
        status: 'active',
        approvalStatus: 'approved',
        discoveryScheduleEnabled: true,
        nextDiscoveryAt: { $lte: new Date() },
      }).sort({ nextDiscoveryAt: 1 }).limit(10).lean();
      const discoveryAllowlist = parseAllowlist(process.env.DISCOVERY_ALLOWLIST);
      const [authorizationSetting, networkPolicySetting] = await Promise.all([
        Setting.findOne({ key: 'DISCOVERY_AUTHORIZATION_MODE' }),
        Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
      ]);
      const authorizationMode = getEffectiveDiscoveryAuthorizationMode(
        networkPolicySetting?.value,
        authorizationSetting?.value,
      );
      const subnet = dueSubnets.find((candidate) => (
        Boolean(candidate.scheduleConfiguredBy || candidate.approvedBy)
        && (candidate.authorizationSource !== 'interface_policy'
          || getNetworkAuthorizationPolicy(networkPolicySetting?.value).autoAuthorizeInterfaces)
        && isFreshInterfaceAuthorization(candidate)
        && Boolean(getApprovedSubnetDiscoveryHosts(candidate, discoveryAllowlist, authorizationMode).hosts)
      ));
      if (!subnet) return;
      await runDiscoveryForSubnet({
        subnetId: subnet._id,
        requestedBy: subnet.scheduleConfiguredBy || subnet.approvedBy,
        trigger: 'scheduled',
        options: { resolveDns: false, checkServices: false, ports: [] },
      });
    } catch (error) {
      if (error.statusCode !== 409 && error.statusCode !== 429) {
        console.error('Scheduled discovery failed:', error.statusCode || error.name || 'UnknownError');
      }
    } finally {
      scheduledDiscoveryRunning = false;
    }
  };

  const runCycle = async () => {
    try {
      await updateSettingsCache();
      if (isEmergencyStopActive()) {
        console.warn('Emergency stop is active; skipping monitoring cycle');
        return;
      }

      const now = Date.now();
      const [activeCollectors, approvedSubnets, networkPolicySetting] = await Promise.all([
        Collector.find({ status: 'active' }).select('subnet').lean(),
        Subnet.find({ status: 'active', approvalStatus: 'approved' }).lean(),
        Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
      ]);
      const monitoringSubnetIds = new Set(
        approvedSubnets
          .filter((subnet) => subnet.monitoringEnabled)
          .map((subnet) => String(subnet._id)),
      );
      const activeCollectorSubnets = activeCollectors
        .map((collector) => collector.subnet)
        .filter((subnetId) => monitoringSubnetIds.has(String(subnetId)));
      const devices = await Device.find({
        monitoringStatus: true,
        collectorId: null,
        subnet: { $nin: activeCollectorSubnets },
      }).select('+snmpCommunity +snmpAuthKey +snmpPrivKey');
      const networkAuthorizationPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
      const monitoringAllowlist = parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST);
      const dueDevices = devices.filter((device) => {
        const previousPoll = lastPolledAt.get(String(device._id)) || 0;
        if (!isDeviceDueForPolling(device, now, previousPoll) || isEmergencyStopActive()) return false;
        lastPolledAt.set(String(device._id), now);
        return true;
      });

      let localCounterSnapshot = null;
      const hasAuthorizedTargets = dueDevices.some((device) => (
        authorizeMonitoringDevice(
          device,
          approvedSubnets,
          monitoringAllowlist,
          {
            authorizationMode: networkAuthorizationPolicy.mode,
            autoAuthorizeInterfaces: networkAuthorizationPolicy.autoAuthorizeInterfaces,
          },
        ).authorized
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
            await processDevice(
              device,
              rateLimiter,
              localCounterSnapshot,
              approvedSubnets,
              networkAuthorizationPolicy.mode,
              networkAuthorizationPolicy.autoAuthorizeInterfaces,
            );
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
  discoveryTask = cron.schedule('*/30 * * * * *', runScheduledDiscovery);
  interfaceAuthorizationTask = cron.schedule('*/1 * * * *', () => {
    synchronizeConnectedInterfaces()
      .catch((error) => console.error('Connected interface authorization sync failed:', error.name || 'UnknownError'));
  });
  console.log('Monitoring engine started');
}

async function stopMonitoring() {
  if (monitoringTask) monitoringTask.stop();
  monitoringTask = null;
  if (discoveryTask) discoveryTask.stop();
  discoveryTask = null;
  if (interfaceAuthorizationTask) interfaceAuthorizationTask.stop();
  interfaceAuthorizationTask = null;
  monitoringStarted = false;
  if (currentCyclePromise) await currentCyclePromise;
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  processDevice,
  upsertAlert,
  resolveAlert,
  updateSettingsCache,
  collectSnmp,
  classifySnmpError,
  testDeviceTelemetry,
};
