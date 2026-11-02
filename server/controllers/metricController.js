const Metric = require('../models/Metric');
const Device = require('../models/Device');
const mongoose = require('mongoose');
const { getAll, getByCat } = require('../config/metricsRegistry');
const Setting = require('../models/Setting');
const { createMetricCoverage, summarizeMetricCoverage } = require('../utils/metricCoverage');

const getMetricRegistry = (req, res) => {
  const category = req.query.category;
  const metrics = category ? getByCat(category) : getAll();
  if (category && metrics.length === 0) {
    return res.status(400).json({ message: 'Unknown metric category' });
  }
  res.json({ count: metrics.length, metrics });
};

const getMetricCoverage = async (req, res) => {
  try {
    const requestedDeviceId = req.query.device;
    if (requestedDeviceId && !mongoose.Types.ObjectId.isValid(requestedDeviceId)) {
      return res.status(400).json({ message: 'Invalid device ID' });
    }

    const deviceFilter = requestedDeviceId ? { _id: requestedDeviceId } : {};
    const devices = await Device.find(deviceFilter)
      .select('_id name ipAddress monitoringMethod pollingInterval')
      .limit(500)
      .lean();
    const deviceIds = devices.map((device) => device._id);
    const latestMetrics = deviceIds.length
      ? await Metric.aggregate([
        { $match: { device: { $in: deviceIds } } },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$device', latestMetric: { $first: '$$ROOT' } } },
      ])
      : [];
    const latestByDevice = new Map(latestMetrics.map((row) => [String(row._id), row.latestMetric]));
    const deviceCoverage = devices.map((device) => {
      const coverage = createMetricCoverage(device, latestByDevice.get(String(device._id)) || null, getAll());
      return {
        deviceId: String(device._id),
        name: device.name,
        ipAddress: device.ipAddress,
        ...coverage,
      };
    });

    if (requestedDeviceId) {
      const [device] = deviceCoverage;
      if (!device) return res.status(404).json({ message: 'Device not found' });
      return res.json(device);
    }

    const summary = summarizeMetricCoverage(deviceCoverage.flatMap((device) => (
      device.metrics.map((metric) => ({ status: metric.status }))
    )));
    res.json({
      ...summary,
      deviceCount: deviceCoverage.length,
      devices: deviceCoverage.map(({ deviceId, name, ipAddress, summary: deviceSummary }) => ({
        deviceId,
        name,
        ipAddress,
        ...deviceSummary,
      })),
    });
  } catch (error) {
    console.error('Metric coverage query failed:', error);
    res.status(500).json({ message: 'Unable to load metric coverage' });
  }
};

const getDeviceMetrics = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid device ID' });
    }

    const durations = { '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000 };
    const range = req.query.range || '1h';
    if (!Object.prototype.hasOwnProperty.call(durations, range)) {
      return res.status(400).json({ message: 'Range must be one of 1h, 6h, 24h, or 7d' });
    }

    const metrics = await Metric.find({
      device: req.params.id,
      createdAt: { $gte: new Date(Date.now() - durations[range]) },
    })
      .sort({ createdAt: -1 })
      .limit(1000);
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const getDashboardSummary = async (req, res) => {
  try {
    const totalDevices = await Device.countDocuments();
    const deviceIds = await Device.distinct('_id');
    const monitoringDevices = await Device.countDocuments({ monitoringStatus: true });
    const onlineDevices = await Device.countDocuments({ status: 'UP' });
    const offlineDevices = await Device.countDocuments({ status: 'DOWN' });
    const warningDevices = await Device.countDocuments({ status: 'WARNING' });
    const unknownDevices = await Device.countDocuments({ status: 'UNKNOWN' });
    const simulationSetting = await Setting.findOne({ key: 'SIMULATION_MODE' });
    const measurementSource = !simulationSetting || simulationSetting.value === true || simulationSetting.value === 'true'
      ? 'simulated'
      : 'real';
    const recentRealMeasurement = measurementSource === 'real'
      ? await Metric.findOne({
        device: { $in: deviceIds },
        measurementSource: 'real',
        collectionStatus: { $in: ['success', 'timeout'] },
        validity: 'valid',
        createdAt: { $gte: new Date(Date.now() - 60_000) },
      }).sort({ createdAt: -1 }).select('createdAt').lean()
      : null;
    
    // Get latest metrics for averages
    const latestMetricFilter = measurementSource === 'real'
      ? {
        measurementSource,
        validity: 'valid',
        collectionStatus: { $in: ['success', 'timeout'] },
      }
      : { measurementSource };
    const latestMetrics = await Metric.aggregate([
      {
        $match: {
          device: { $in: deviceIds },
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          ...latestMetricFilter,
        },
      },
      { $sort: { createdAt: -1 } },
      { $group: {
          _id: "$device",
          latency: { $first: "$latency" },
          packetLoss: { $first: "$packetLoss" },
          status: { $first: "$status" },
          cpuUtilization: { $first: "$hardware.cpu.utilization" },
          memoryUtilization: { $first: "$hardware.memory.utilization" }
        }
      }
    ]);
    
    let totalLatency = 0;
    let totalPacketLoss = 0;
    let validLatencyCount = 0;
    let validPacketLossCount = 0;
    let totalCpu = 0;
    let totalMemory = 0;
    let validCpuCount = 0;
    let validMemoryCount = 0;
    
    latestMetrics.forEach(m => {
      if (m.latency !== null && m.latency !== undefined) {
        totalLatency += m.latency;
        validLatencyCount++;
      }
      if (m.packetLoss !== null && m.packetLoss !== undefined) {
        totalPacketLoss += m.packetLoss;
        validPacketLossCount++;
      }
      if (m.cpuUtilization !== null && m.cpuUtilization !== undefined) {
        totalCpu += m.cpuUtilization;
        validCpuCount++;
      }
      if (m.memoryUtilization !== null && m.memoryUtilization !== undefined) {
        totalMemory += m.memoryUtilization;
        validMemoryCount++;
      }
    });

    const avgLatency = validLatencyCount > 0 ? Number((totalLatency / validLatencyCount).toFixed(2)) : null;
    const avgPacketLoss = validPacketLossCount > 0 ? Number((totalPacketLoss / validPacketLossCount).toFixed(2)) : null;
    const avgCpu = validCpuCount > 0 ? Number((totalCpu / validCpuCount).toFixed(1)) : null;
    const avgMemory = validMemoryCount > 0 ? Number((totalMemory / validMemoryCount).toFixed(1)) : null;

    res.json({
      totalDevices,
      monitoringDevices,
      onlineDevices,
      offlineDevices,
      warningDevices,
      unknownDevices,
      reachableDevices: onlineDevices + warningDevices,
      avgLatency,
      avgPacketLoss,
      avgCpu,
      avgMemory,
      measurementSource,
      hasRecentRealTelemetry: Boolean(recentRealMeasurement),
      latestRealMeasurementAt: recentRealMeasurement?.createdAt || null,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getDeviceMetrics, getDashboardSummary, getMetricRegistry, getMetricCoverage };
