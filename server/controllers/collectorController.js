const mongoose = require('mongoose');
const Collector = require('../models/Collector');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Subnet = require('../models/Subnet');
const Setting = require('../models/Setting');
const Alert = require('../models/Alert');
const { calculateOverallHealthScore } = require('../utils/healthScoreEngine');
const { transitionDeviceHealth } = require('../utils/deviceHealthState');
const { getApprovedDiscoveryHosts } = require('../utils/networkSafety');
const { validateCollectorReport } = require('../utils/collectorReport');
const { createCollectorToken, hashCollectorToken } = require('../utils/collectorToken');
const { getIO } = require('../services/socketService');
const { upsertAlert, resolveAlert } = require('../services/monitoringEngine');

function publicCollector(collector) {
  const result = collector.toObject ? collector.toObject() : { ...collector };
  delete result.tokenHash;
  return result;
}

async function getActiveSubnet(collector) {
  const subnetId = collector.subnet?._id || collector.subnet;
  const subnet = await Subnet.findById(subnetId);
  if (!subnet || subnet.status !== 'active' || subnet.approvalStatus !== 'approved'
    || subnet.monitoringEnabled !== true) {
    return null;
  }
  const allowed = getApprovedDiscoveryHosts(subnet.cidr, [], 256, { requireAllowlist: false });
  return allowed.error ? null : subnet;
}

const listCollectors = async (req, res) => {
  try {
    const collectors = await Collector.find({})
      .select('-tokenHash')
      .populate('subnet', 'name cidr status approvalStatus monitoringEnabled')
      .sort({ createdAt: -1 })
      .limit(100);
    return res.json(collectors);
  } catch (error) {
    console.error('Collector list failed:', error.name || 'UnknownError');
    return res.status(500).json({ message: 'Unable to load collectors' });
  }
};

const createCollector = async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
      || Object.keys(req.body).some((key) => !['name', 'subnetId'].includes(key))) {
      return res.status(400).json({ message: 'Collector registration payload is invalid' });
    }
    const { name, subnetId } = req.body;
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 120) {
      return res.status(400).json({ message: 'Collector name must be between 1 and 120 characters' });
    }
    if (!mongoose.Types.ObjectId.isValid(subnetId)) {
      return res.status(400).json({ message: 'A valid subnet ID is required' });
    }

    const subnet = await Subnet.findById(subnetId);
    if (!subnet || subnet.status !== 'active' || subnet.approvalStatus !== 'approved'
      || subnet.monitoringEnabled !== true) {
      return res.status(400).json({ message: 'Collector scope must be an active, approved, monitoring-enabled subnet' });
    }
    const scope = getApprovedDiscoveryHosts(subnet.cidr, [], 256, { requireAllowlist: false });
    if (scope.error || scope.hosts.length !== subnet.usableHostCount) {
      return res.status(400).json({ message: 'Collector scope is not a supported bounded private subnet' });
    }
    if (await Collector.findOne({ subnet: subnet._id, status: 'active' })) {
      return res.status(409).json({ message: 'An active collector already owns this subnet' });
    }

    const token = createCollectorToken();
    const collector = await Collector.create({
      name: name.trim(),
      subnet: subnet._id,
      tokenHash: hashCollectorToken(token),
      createdBy: req.user._id,
    });
    try {
      await Device.updateMany(
        { subnet: subnet._id, enrollmentStatus: 'approved', monitoringStatus: true },
        { $set: { collectorId: collector._id } },
      );
    } catch (error) {
      await Collector.updateOne({ _id: collector._id }, {
        $set: { status: 'revoked', revokedAt: new Date() },
      });
      await Device.updateMany(
        { collectorId: collector._id },
        { $set: { collectorId: null } },
      );
      throw error;
    }

    const populated = await Collector.findById(collector._id)
      .select('-tokenHash')
      .populate('subnet', 'name cidr status approvalStatus monitoringEnabled');
    console.info(JSON.stringify({
      event: 'collector.created',
      actorId: String(req.user._id),
      collectorId: String(collector._id),
      subnetId: String(subnet._id),
      at: new Date().toISOString(),
    }));
    return res.status(201).json({
      collector: publicCollector(populated || collector),
      token,
    });
  } catch (error) {
    console.error('Collector creation failed:', error.name || 'UnknownError');
    return res.status(error.code === 11000 ? 409 : 500).json({
      message: error.code === 11000
        ? 'An active collector already owns this subnet'
        : 'Unable to create collector',
    });
  }
};

const revokeCollector = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid collector ID' });
    }
    const collector = await Collector.findById(req.params.id);
    if (!collector) return res.status(404).json({ message: 'Collector not found' });
    const wasActive = collector.status !== 'revoked';
    if (wasActive) {
      collector.status = 'revoked';
      collector.revokedAt = new Date();
      await collector.save();
    }
    await Device.updateMany(
      { collectorId: collector._id },
      { $set: { collectorId: null } },
    );
    if (wasActive) {
      console.info(JSON.stringify({
        event: 'collector.revoked',
        actorId: String(req.user._id),
        collectorId: String(collector._id),
        subnetId: String(collector.subnet),
        at: new Date().toISOString(),
      }));
    }
    return res.json({ message: 'Collector token revoked', collector: publicCollector(collector) });
  } catch (error) {
    console.error('Collector revocation failed:', error.name || 'UnknownError');
    return res.status(500).json({ message: 'Unable to revoke collector token' });
  }
};

const collectorHeartbeat = async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['agentVersion', 'subnetCidr', 'activeTargets'].includes(key))
      || typeof body.agentVersion !== 'string' || body.agentVersion.length < 1 || body.agentVersion.length > 40
      || !Number.isInteger(body.activeTargets) || body.activeTargets < 0 || body.activeTargets > 256) {
      return res.status(400).json({ message: 'Heartbeat payload is invalid' });
    }
    const subnet = await getActiveSubnet(req.collector);
    if (!subnet) return res.status(403).json({ message: 'Collector subnet is not active and monitoring-enabled' });
    const scope = getApprovedDiscoveryHosts(subnet.cidr, [], 256, { requireAllowlist: false });
    if (body.subnetCidr !== subnet.cidr || body.activeTargets > scope.hosts.length) {
      return res.status(400).json({ message: 'Heartbeat does not match the collector subnet scope' });
    }

    req.collector.lastHeartbeatAt = new Date();
    req.collector.agentVersion = body.agentVersion;
    await req.collector.save();
    return res.json({ accepted: true, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('Collector heartbeat failed:', error.name || 'UnknownError');
    return res.status(500).json({ message: 'Unable to record collector heartbeat' });
  }
};

async function readHealthThresholds() {
  const settings = await Setting.find({
    key: { $in: ['DEVICE_DOWN_FAILURE_THRESHOLD', 'DEVICE_UP_RECOVERY_THRESHOLD', 'LATENCY_WARNING', 'PACKET_LOSS_WARNING'] },
  });
  const values = new Map(settings.map((setting) => [setting.key, Number(setting.value)]));
  return {
    failureThreshold: values.get('DEVICE_DOWN_FAILURE_THRESHOLD') || 3,
    recoveryThreshold: values.get('DEVICE_UP_RECOVERY_THRESHOLD') || 2,
    latencyWarning: values.get('LATENCY_WARNING') ?? 100,
    packetLossWarning: values.get('PACKET_LOSS_WARNING') ?? 5,
  };
}

async function recordObservation(collector, subnet, observation, receivedAt, thresholds) {
  let device = await Device.findOne({ ipAddress: observation.ipAddress });
  let discovered = false;
  if (!device) {
    if (!observation.reachable) return { discovered: false, monitored: false, ignored: true };
    try {
      device = await Device.create({
        name: observation.ipAddress,
        ipAddress: observation.ipAddress,
        type: 'other',
        subnet: subnet._id,
        collectorId: collector._id,
        enrollmentStatus: 'pending',
        enrollmentSource: 'discovery',
        discoverySource: `collector:${collector._id}`,
        firstDiscoveredAt: receivedAt,
        lastDiscoveredAt: receivedAt,
        lastCollectorObservationAt: observation.observedAt,
        monitoringStatus: false,
        status: 'UNKNOWN',
      });
      discovered = true;
    } catch (error) {
      if (error.code !== 11000) throw error;
      device = await Device.findOne({ ipAddress: observation.ipAddress });
      if (!device) throw error;
    }
  }

  if (String(device.subnet || '') !== String(subnet._id)
    || (device.collectorId && String(device.collectorId) !== String(collector._id))) {
    return { discovered, monitored: false, ignored: true };
  }
  if (!device.collectorId) device.collectorId = collector._id;
  device.lastDiscoveredAt = receivedAt;
  if (device.lastCollectorObservationAt
    && observation.observedAt.getTime() <= new Date(device.lastCollectorObservationAt).getTime()) {
    await device.save();
    return { discovered, monitored: false, ignored: true };
  }

  device.lastCollectorObservationAt = observation.observedAt;
  if (device.enrollmentStatus !== 'approved' || device.monitoringStatus !== true) {
    await device.save();
    return { discovered, monitored: false, ignored: false };
  }

  const previousStatus = device.status || 'UNKNOWN';
  const degraded = observation.reachable && (
    (observation.latencyMs !== null && observation.latencyMs >= thresholds.latencyWarning)
    || observation.packetLoss >= thresholds.packetLossWarning
  );
  const status = transitionDeviceHealth(device, {
    reachable: observation.reachable,
    degraded,
  }, thresholds);
  const health = calculateOverallHealthScore({
    deviceStatus: status,
    availabilityPercent: 100 - observation.packetLoss,
    latency: observation.latencyMs,
    packetLoss: observation.packetLoss,
  });

  device.status = status;
  device.healthScore = health.overallScore;
  device.healthStatus = health.healthStatus;
  if (observation.reachable) device.lastSeen = receivedAt;
  await device.save();

  const metric = await Metric.create({
    device: device._id,
    metricSchemaVersion: 3,
    latency: observation.latencyMs,
    packetLoss: observation.packetLoss,
    availability: 100 - observation.packetLoss,
    status,
    measurementSource: 'real',
    monitoringMode: 'real',
    source: 'https-collector',
    sourceProtocol: 'icmp',
    availabilityStatus: 'available',
    validity: 'valid',
    collectionStatus: observation.reachable ? 'success' : 'unreachable',
    observationWindowStart: observation.observedAt,
    observationWindowEnd: receivedAt,
    sampleCount: 1,
    reachability: {
      confirmedMethod: observation.reachable ? 'icmp' : null,
      isReachable: observation.reachable,
      methodsChecked: ['icmp'],
      methodsResponding: observation.reachable ? ['icmp'] : [],
      reason: observation.reachable ? null : 'No ICMP response from the approved collector scope',
    },
    health: {
      overallScore: health.overallScore,
      healthStatus: health.healthStatus,
      availabilityScore: health.availabilityScore,
      performanceScore: health.performanceScore,
      trafficScore: health.trafficScore,
      hardwareScore: health.hardwareScore,
      breakdown: health.breakdown,
    },
    derived: { source: 'remote-collector', collectorId: String(collector._id) },
  });

  if (status === 'DOWN') {
    await upsertAlert(device, 'DEVICE_DOWN', 'CRITICAL', `${device.name} is unreachable`);
  } else if (status === 'UP' || status === 'WARNING') {
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

  getIO().emit('deviceUpdated', device.toJSON());
  getIO().emit('metricAdded', metric);
  return { discovered, monitored: true, ignored: false };
}

const collectorReport = async (req, res) => {
  try {
    const subnet = await getActiveSubnet(req.collector);
    if (!subnet) return res.status(403).json({ message: 'Collector subnet is not active and monitoring-enabled' });
    const validation = validateCollectorReport(req.body, subnet);
    if (validation.error) return res.status(400).json({ message: validation.error });

    const receivedAt = new Date();
    const thresholds = await readHealthThresholds();
    const counts = { accepted: 0, discovered: 0, ignored: 0 };
    for (const observation of validation.observations) {
      const result = await recordObservation(req.collector, subnet, observation, receivedAt, thresholds);
      if (result.ignored) counts.ignored += 1;
      else counts.accepted += 1;
      if (result.discovered) counts.discovered += 1;
    }

    req.collector.lastReportAt = receivedAt;
    req.collector.lastReportedDeviceCount = validation.observations.length;
    await req.collector.save();
    return res.json(counts);
  } catch (error) {
    console.error('Collector report failed:', error.name || 'UnknownError');
    return res.status(500).json({ message: 'Unable to process collector report' });
  }
};

module.exports = {
  collectorHeartbeat,
  collectorReport,
  createCollector,
  listCollectors,
  publicCollector,
  revokeCollector,
};
