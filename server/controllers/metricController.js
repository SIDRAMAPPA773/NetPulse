const Metric = require('../models/Metric');
const Device = require('../models/Device');

const getDeviceMetrics = async (req, res) => {
  try {
    const metrics = await Metric.find({ device: req.params.id })
                                .sort({ createdAt: -1 })
                                .limit(60); // Get last 60 metrics (e.g. 30 mins if 30s interval)
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const getDashboardSummary = async (req, res) => {
  try {
    const totalDevices = await Device.countDocuments();
    const onlineDevices = await Device.countDocuments({ status: 'UP' });
    const offlineDevices = await Device.countDocuments({ status: 'DOWN' });
    const warningDevices = await Device.countDocuments({ status: 'WARNING' });
    
    // Get latest metrics for averages
    const latestMetrics = await Metric.aggregate([
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
    
    latestMetrics.forEach(m => {
      if (m.latency !== null && m.latency !== undefined) {
        totalLatency += m.latency;
        validLatencyCount++;
      }
      if (m.packetLoss !== null && m.packetLoss !== undefined) {
        totalPacketLoss += m.packetLoss;
      }
    });

    const avgLatency = validLatencyCount > 0 ? (totalLatency / validLatencyCount).toFixed(2) : 0;
    const avgPacketLoss = latestMetrics.length > 0 ? (totalPacketLoss / latestMetrics.length).toFixed(2) : 0;

    res.json({
      totalDevices,
      onlineDevices,
      offlineDevices,
      warningDevices,
      avgLatency: Number(avgLatency),
      avgPacketLoss: Number(avgPacketLoss)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

module.exports = { getDeviceMetrics, getDashboardSummary };
