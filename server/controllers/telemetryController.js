const mongoose = require('mongoose');
const Device = require('../models/Device');
const { testDeviceTelemetry } = require('../services/monitoringEngine');

function collectorResult(metricId, value, checks, snmpData) {
  const metricChecks = checks.filter((check) => check.metricId === metricId);
  if (value !== null && value !== undefined) return { status: 'AVAILABLE', reason: null };
  const failedCheck = metricChecks.find((check) => (
    ['AUTHENTICATION_FAILED', 'TIMEOUT', 'COLLECTION_ERROR'].includes(check.responseStatus)
  ));
  if (failedCheck) return { status: failedCheck.responseStatus, reason: failedCheck.reason };
  if (snmpData.errorCode) return { status: snmpData.errorCode, reason: snmpData.reason };
  if (metricChecks.length && metricChecks.every((check) => check.responseStatus === 'UNSUPPORTED')) {
    return {
      status: 'UNSUPPORTED',
      reason: metricChecks.find((check) => check.reason)?.reason || 'No supported OID responded',
    };
  }
  return {
    status: 'UNAVAILABLE',
    reason: snmpData.hardware?.[metricId === 'cpu_utilization'
      ? 'cpu'
      : metricId === 'memory_utilization'
        ? 'memory'
        : 'temperature']?.reason || 'No valid value was returned by the collector',
  };
}

const testTelemetry = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid device ID' });
    }

    const device = await Device.findById(req.params.id)
      .select('+snmpAuthKey +snmpPrivKey +telemetryDiagnostics');
    if (!device) return res.status(404).json({ message: 'Device not found' });

    const diagnostic = await testDeviceTelemetry(device);
    if (diagnostic.errorCode) {
      const status = diagnostic.errorCode === 'COOLDOWN' || diagnostic.errorCode === 'TEST_BUSY'
        ? 429
        : diagnostic.errorCode === 'TARGET_NOT_APPROVED' || diagnostic.errorCode === 'EMERGENCY_STOP'
          ? 403
          : 409;
      return res.status(status).json({
        status: diagnostic.errorCode,
        reason: diagnostic.message,
      });
    }

    const checks = diagnostic.snmp.oidChecks || [];
    const collectors = {
      cpu: collectorResult('cpu_utilization', diagnostic.snmp.hardware?.cpu?.utilization, checks, diagnostic.snmp),
      memory: collectorResult('memory_utilization', diagnostic.snmp.hardware?.memory?.utilization, checks, diagnostic.snmp),
      temperature: collectorResult('temperature', diagnostic.snmp.hardware?.temperature?.celsius, checks, diagnostic.snmp),
      uptime: collectorResult('device_uptime', diagnostic.snmp.sysUpTime, checks, diagnostic.snmp),
      interface: Number.isInteger(diagnostic.snmp.ifIndex) && diagnostic.snmp.countersSupported
        ? { status: 'AVAILABLE', reason: null }
        : !diagnostic.snmp.ifIndex
          ? { status: 'NOT_CONFIGURED', reason: 'Configure an SNMP interface index to collect interface counters' }
          : { status: 'UNAVAILABLE', reason: diagnostic.snmp.reason || 'Interface counters were not returned' },
      agent: {
        status: 'NOT_CONFIGURED',
        reason: 'No authenticated Windows or Linux host exporter is configured',
      },
    };
    device.telemetryDiagnostics = {
      status: diagnostic.status,
      reason: diagnostic.reason,
      snmpVersion: diagnostic.snmpVersion,
      collectedAt: diagnostic.collectedAt,
      collectionDurationMs: diagnostic.collectionDurationMs,
      checks,
      collectors,
    };
    await device.save();

    res.json({
      deviceId: diagnostic.deviceId,
      status: diagnostic.status,
      reason: diagnostic.reason,
      snmpVersion: diagnostic.snmpVersion,
      collectedAt: diagnostic.collectedAt,
      collectionDurationMs: diagnostic.collectionDurationMs,
      checks,
      collectors,
    });
  } catch (error) {
    console.error('Telemetry diagnostic failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to run telemetry diagnostic' });
  }
};

module.exports = { testTelemetry };
