const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const Setting = require('../models/Setting');
const { isValidIPv4 } = require('../utils/ipValidation');
const { probeIcmp } = require('../utils/icmpProbe');
const { Semaphore, createRateLimiter } = require('../utils/safety');
const { mapDiscoveredDevices } = require('../utils/discoveryResults');
const { createDeviceMonitoringSummary } = require('../utils/deviceMonitoring');
const {
  MAX_DISCOVERY_HOSTS,
  parseAllowlist,
  getApprovedDiscoveryHosts,
  createCooldownGuard,
  setEmergencyStop,
  isEmergencyStopActive,
} = require('../utils/networkSafety');

const discoveryGuard = createCooldownGuard(60_000);
const DISCOVERY_CONCURRENCY = Number.isInteger(Number(process.env.DISCOVERY_MAX_CONCURRENCY))
  ? Math.min(4, Math.max(1, Number(process.env.DISCOVERY_MAX_CONCURRENCY)))
  : 2;
const DISCOVERY_RATE_PER_SECOND = Number.isInteger(Number(process.env.DISCOVERY_MAX_PROBES_PER_SECOND))
  ? Math.min(4, Math.max(1, Number(process.env.DISCOVERY_MAX_PROBES_PER_SECOND)))
  : 2;

const publicDevice = (device) => {
  const result = device.toObject ? device.toObject() : { ...device };
  delete result.snmpCommunity;
  return result;
};

const getDevices = async (req, res) => {
  try {
    const devices = await Device.find({})
      .select('-snmpCommunity')
      .sort({ name: 1 })
      .limit(500);
    if (devices.length === 0) return res.json([]);

    const deviceIds = devices.map((device) => device._id);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [metricSummaries, successfulMeasurements, alertCounts] = await Promise.all([
      Metric.aggregate([
        { $match: { device: { $in: deviceIds }, metricSchemaVersion: 2, createdAt: { $gte: since } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$device',
            latestMetric: {
              $first: {
                latency: '$latency',
                packetLoss: '$packetLoss',
                availability: '$availability',
                availabilityStatus: '$availabilityStatus',
                collectionStatus: '$collectionStatus',
                reasonUnavailable: '$reasonUnavailable',
                status: '$status',
                monitoringMode: '$monitoringMode',
                incomingTraffic: '$incomingThroughputBps',
                outgoingTraffic: '$outgoingThroughputBps',
                measurementSource: '$measurementSource',
                createdAt: '$createdAt',
                derived: '$derived',
              },
            },
            recentLatency: { $push: '$latency' },
          },
        },
        { $project: { latestMetric: 1, recentLatency: { $slice: ['$recentLatency', 10] } } },
      ]),
      Metric.aggregate([
        { $match: { device: { $in: deviceIds }, availabilityStatus: 'available' } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$device',
            latestSuccessfulMeasurement: {
              $first: {
                createdAt: '$createdAt',
                measurementSource: '$measurementSource',
                monitoringMode: '$monitoringMode',
              },
            },
          },
        },
      ]),
      Alert.aggregate([
        { $match: { device: { $in: deviceIds }, status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } } },
        { $group: { _id: { device: '$device', severity: '$severity' }, count: { $sum: 1 } } },
      ]),
    ]);

    const metricsByDevice = new Map(metricSummaries.map((summary) => [String(summary._id), summary]));
    const successfulMeasurementsByDevice = new Map(successfulMeasurements.map(
      (summary) => [String(summary._id), summary.latestSuccessfulMeasurement],
    ));
    const monitoringAllowlist = parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST);
    const alertsByDevice = new Map();
    for (const summary of alertCounts) {
      const deviceKey = String(summary._id.device);
      const counts = alertsByDevice.get(deviceKey) || {};
      counts[summary._id.severity] = summary.count;
      alertsByDevice.set(deviceKey, counts);
    }
    res.json(devices.map((device) => {
      const metricSummary = metricsByDevice.get(String(device._id));
      const alertCountsForDevice = alertsByDevice.get(String(device._id)) || {};
      return {
        ...createDeviceMonitoringSummary(
          publicDevice(device),
          metricSummary?.latestMetric || null,
          monitoringAllowlist,
          successfulMeasurementsByDevice.get(String(device._id)) || null,
        ),
        recentLatency: (metricSummary?.recentLatency || []).reverse(),
        alertCounts: alertCountsForDevice,
        activeAlertCount: Object.values(alertCountsForDevice).reduce((total, count) => total + count, 0),
      };
    }));
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const getDeviceById = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id).select('-snmpCommunity');
    if (device) {
      const [latestCollection, latestSuccessfulMeasurement] = await Promise.all([
        Metric.findOne({ device: device._id })
          .sort({ createdAt: -1 })
          .select('createdAt measurementSource collectionStatus availabilityStatus validity reasonUnavailable latency packetLoss cpuUtilization memoryUtilization incomingThroughputBps outgoingThroughputBps interfaceId derived')
          .lean(),
        Metric.findOne({
          device: device._id,
          availabilityStatus: 'available',
        })
          .sort({ createdAt: -1 })
          .select('createdAt measurementSource monitoringMode')
          .lean(),
      ]);
      res.json({
        ...publicDevice(device),
        latestCollection,
        latestSuccessfulMeasurement,
      });
    } else {
      res.status(404).json({ message: 'Device not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const createDevice = async (req, res) => {
  try {
    const { name, ipAddress, type, location, description, monitoringMethod, pollingInterval, snmpCommunity, snmpVersion, snmpInterfaceIndex } = req.body;
    if (!isValidIPv4(ipAddress)) {
      return res.status(400).json({ message: 'A valid IPv4 address is required' });
    }
    if (!Number.isInteger(pollingInterval === undefined ? 30 : Number(pollingInterval)) ||
        Number(pollingInterval === undefined ? 30 : pollingInterval) < 10 ||
        Number(pollingInterval === undefined ? 30 : pollingInterval) > 3600) {
      return res.status(400).json({ message: 'Polling interval must be between 10 and 3600 seconds' });
    }
    if (snmpInterfaceIndex !== undefined &&
        (!Number.isInteger(Number(snmpInterfaceIndex)) || Number(snmpInterfaceIndex) < 1)) {
      return res.status(400).json({ message: 'SNMP interface index must be a positive integer' });
    }

    const deviceExists = await Device.findOne({ ipAddress });
    if (deviceExists) {
      return res.status(400).json({ message: 'Device with this IP already exists' });
    }

    const device = new Device({
      name, ipAddress, type, location, description, monitoringMethod, pollingInterval, snmpCommunity, snmpVersion,
      snmpInterfaceIndex: snmpInterfaceIndex === undefined ? undefined : Number(snmpInterfaceIndex),
    });

    const createdDevice = await device.save();
    res.status(201).json(publicDevice(createdDevice));
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateDevice = async (req, res) => {
  try {
    const { name, ipAddress, type, location, description, monitoringMethod, monitoringStatus, pollingInterval, snmpCommunity, snmpVersion, snmpInterfaceIndex } = req.body;
    if (ipAddress !== undefined && !isValidIPv4(ipAddress)) {
      return res.status(400).json({ message: 'A valid IPv4 address is required' });
    }
    if (pollingInterval !== undefined &&
        (!Number.isInteger(Number(pollingInterval)) || Number(pollingInterval) < 10 || Number(pollingInterval) > 3600)) {
      return res.status(400).json({ message: 'Polling interval must be between 10 and 3600 seconds' });
    }
    if (snmpInterfaceIndex !== undefined &&
        (!Number.isInteger(Number(snmpInterfaceIndex)) || Number(snmpInterfaceIndex) < 1)) {
      return res.status(400).json({ message: 'SNMP interface index must be a positive integer' });
    }
    const device = await Device.findById(req.params.id);

    if (device) {
      device.name = name || device.name;
      device.ipAddress = ipAddress || device.ipAddress;
      device.type = type || device.type;
      device.location = location || device.location;
      device.description = description || device.description;
      device.monitoringMethod = monitoringMethod || device.monitoringMethod;
      device.monitoringStatus = monitoringStatus !== undefined ? monitoringStatus : device.monitoringStatus;
      if (!device.monitoringStatus) device.status = 'UNKNOWN';
      device.pollingInterval = pollingInterval === undefined ? device.pollingInterval : Number(pollingInterval);
      device.snmpCommunity = snmpCommunity === undefined ? device.snmpCommunity : snmpCommunity;
      device.snmpVersion = snmpVersion || device.snmpVersion;
      device.snmpInterfaceIndex = snmpInterfaceIndex === undefined ? device.snmpInterfaceIndex : Number(snmpInterfaceIndex);

      const updatedDevice = await device.save();
      res.json(publicDevice(updatedDevice));
    } else {
      res.status(404).json({ message: 'Device not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const deleteDevice = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (device) {
      await Device.deleteOne({ _id: req.params.id });
      res.json({ message: 'Device removed' });
    } else {
      res.status(404).json({ message: 'Device not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const discoverLocalDevices = async (req, res) => {
  const cidr = req.body && req.body.cidr;
  const allowlist = parseAllowlist(process.env.DISCOVERY_ALLOWLIST);
  const approval = getApprovedDiscoveryHosts(cidr, allowlist, MAX_DISCOVERY_HOSTS);
  if (approval.error) {
    const status = approval.error === 'NOT_ALLOWLISTED' ? 403 : 400;
    return res.status(status).json({
      message: approval.error === 'NOT_ALLOWLISTED'
        ? 'CIDR is not explicitly approved in DISCOVERY_ALLOWLIST'
        : 'CIDR is invalid or exceeds the discovery host limit',
    });
  }

  const simulationSetting = await Setting.findOne({ key: 'SIMULATION_MODE' });
  const simulationMode = simulationSetting ? simulationSetting.value === true || simulationSetting.value === 'true' : true;
  if (simulationMode) {
    return res.status(409).json({ message: 'Discovery is disabled in simulation mode' });
  }

  const emergencyStop = await Setting.findOne({ key: 'EMERGENCY_STOP' });
  const stopActive = Boolean(emergencyStop && (emergencyStop.value === true || emergencyStop.value === 'true'));
  setEmergencyStop(stopActive);
  if (stopActive) {
    return res.status(503).json({ message: 'Emergency stop is active; discovery is disabled' });
  }

  const guard = discoveryGuard.begin(approval.cidr);
  if (!guard.allowed) {
    const status = guard.reason === 'cooldown' ? 429 : 409;
    return res.status(status).json({ message: guard.reason === 'cooldown' ? 'Discovery cooldown is active' : 'A discovery job is already running' });
  }

  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const rateLimiter = createRateLimiter({ maxPerSecond: DISCOVERY_RATE_PER_SECOND });
    const semaphore = new Semaphore(DISCOVERY_CONCURRENCY);
    const discovered = [];
    let nextHostIndex = 0;

    const worker = async () => {
      while (!controller.signal.aborted && !isEmergencyStopActive()) {
        const index = nextHostIndex;
        nextHostIndex += 1;
        if (index >= approval.hosts.length) return;
        await rateLimiter.acquire();
        if (controller.signal.aborted || isEmergencyStopActive()) return;
        const release = await semaphore.acquire();
        try {
          if (controller.signal.aborted || isEmergencyStopActive()) return;
          const ipAddress = approval.hosts[index];
          const probe = await probeIcmp(ipAddress, {
            count: 1,
            timeout: 1,
            signal: controller.signal,
          });
          if (probe.reachable) {
            discovered.push({
              name: `Unidentified host (${ipAddress})`,
              ipAddress,
              type: 'other',
              location: 'Unclassified',
              description: 'ICMP responder; identity has not been verified',
              monitoringMethod: 'icmp',
              status: 'UP',
              latency: probe.rttAvg,
            });
          }
        } finally {
          release();
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, approval.hosts.length) }, worker));
    const discoveredIps = discovered.map((device) => device.ipAddress);
    const existing = await Device.find({ ipAddress: { $in: discoveredIps } })
      .select('_id ipAddress monitoringStatus');
    const monitoringAllowlist = parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST);
    const finalResults = mapDiscoveredDevices(discovered, existing, monitoringAllowlist);

    res.json({
      subnet: approval.cidr,
      count: finalResults.length,
      devices: finalResults
    });
  } catch (error) {
    console.error('Discovery error:', error);
    if (!res.headersSent) res.status(500).json({ message: 'Error scanning approved subnet' });
  } finally {
    discoveryGuard.end();
  }
};

// Batch enroll discovered devices
const enrollMultipleDevices = async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices) || devices.length === 0 || devices.length > MAX_DISCOVERY_HOSTS) {
      return res.status(400).json({ message: 'No devices provided' });
    }

    const created = [];
    for (const item of devices) {
      if (!item || !isValidIPv4(item.ipAddress)) {
        return res.status(400).json({ message: 'Every enrolled device must have a valid IPv4 address' });
      }
      const exists = await Device.findOne({ ipAddress: item.ipAddress });
      if (!exists) {
        const newDev = await Device.create({
          name: item.name || `Device ${item.ipAddress}`,
          ipAddress: item.ipAddress,
          type: item.type || 'switch',
          location: item.location || 'Local Subnet',
          description: item.description || 'Auto-discovered hardware node',
          monitoringMethod: item.monitoringMethod || 'icmp',
          status: 'UP'
        });
        created.push(publicDevice(newDev));
      }
    }

    res.json({ message: `Successfully enrolled ${created.length} devices`, devices: created });
  } catch (error) {
    res.status(500).json({ message: 'Error enrolling devices' });
  }
};

module.exports = { 
  getDevices, 
  getDeviceById, 
  createDevice, 
  updateDevice, 
  deleteDevice,
  discoverLocalDevices,
  enrollMultipleDevices
};
