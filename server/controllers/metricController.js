const Metric = require('../models/Metric');
const Device = require('../models/Device');
const mongoose = require('mongoose');
const { getAll, getByCat } = require('../config/metricsRegistry');
const Setting = require('../models/Setting');

const getMetricRegistry = (req, res) => {
  const category = req.query.category;
  const metrics = category ? getByCat(category) : getAll();
  if (category && metrics.length === 0) {
    return res.status(400).json({ message: 'Unknown metric category' });
  }
  res.json({ count: metrics.length, metrics });
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
    const monitoringDevices = await Device.countDocuments({ monitoringStatus: true });
    const onlineDevices = await Device.countDocuments({ status: 'UP' });
    const offlineDevices = await Device.countDocuments({ status: 'DOWN' });
    const warningDevices = await Device.countDocuments({ status: 'WARNING' });
    const unknownDevices = await Device.countDocuments({ status: 'UNKNOWN' });
    const simulationSetting = await Setting.findOne({ key: 'SIMULATION_MODE' });
    const measurementSource = !simulationSetting || simulationSetting.value === true || simulationSetting.value === 'true'
      ? 'simulated'
      : 'real';
    
    // Get latest metrics for averages
    const latestMetrics = await Metric.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          measurementSource,
        },
      },
      { $sort: { createdAt: -1 } },
      { $group: {
          _id: "$device",
          latency: { $first: "$latency" },
          packetLoss: { $first: "$packetLoss" },
          status: { $first: "$status" }
        }
      }
    ]);
    
    let totalLatency = 0;
    let totalPacketLoss = 0;
    let validLatencyCount = 0;
    let validPacketLossCount = 0;
    
    latestMetrics.forEach(m => {
      if (m.latency !== null && m.latency !== undefined) {
        totalLatency += m.latency;
        validLatencyCount++;
      }
      if (m.packetLoss !== null && m.packetLoss !== undefined) {
        totalPacketLoss += m.packetLoss;
        validPacketLossCount++;
      }
    });

    const avgLatency = validLatencyCount > 0 ? Number((totalLatency / validLatencyCount).toFixed(2)) : null;
    const avgPacketLoss = validPacketLossCount > 0 ? Number((totalPacketLoss / validPacketLossCount).toFixed(2)) : null;

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
      measurementSource,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getDeviceMetrics, getDashboardSummary, getMetricRegistry };
