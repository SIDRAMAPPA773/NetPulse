const Metric = require('../models/Metric');
const Device = require('../models/Device');
const mongoose = require('mongoose');
const { calculateReliability } = require('../services/reliabilityAnalyticsService');

const getPerformance = async (req, res) => {
  try {
    const { device, location, type, range } = req.query;
    const allowedRanges = ['1h', '6h', '24h', '7d', '30d'];
    if (range && !allowedRanges.includes(range)) {
      return res.status(400).json({ message: 'Range must be one of 1h, 6h, 24h, 7d, or 30d' });
    }

    const rangeMilliseconds = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const timeFilter = new Date(Date.now() - rangeMilliseconds[range || '1h']);

    // Build device filter
    const deviceFilter = {};
    if (device) {
      if (!mongoose.Types.ObjectId.isValid(device)) {
        return res.status(400).json({ message: 'Invalid device ID' });
      }
      deviceFilter._id = device;
    }
    if (type && !['router', 'switch', 'server', 'pc', 'printer', 'ap', 'other'].includes(type)) {
      return res.status(400).json({ message: 'Invalid device type' });
    }
    if (location) deviceFilter.location = location;
    if (type) deviceFilter.type = type;

    let deviceIds = [];
    const hasDeviceFilter = Object.keys(deviceFilter).length > 0;
    if (hasDeviceFilter) {
      const devices = await Device.find(deviceFilter).select('_id');
      deviceIds = devices.map(d => d._id);
      if (deviceIds.length === 0) return res.json([]);
    }

    const metricFilter = { createdAt: { $gte: timeFilter } };
    if (hasDeviceFilter) {
      metricFilter.device = { $in: deviceIds };
    }

    const metrics = await Metric.find(metricFilter).sort({ createdAt: -1 }).limit(500);
    res.json(metrics.reverse());
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const getTraffic = async (req, res) => {
  try {
    // Top devices by traffic in last 1 hour
    const timeFilter = new Date(Date.now() - 60 * 60 * 1000);
    
    const latestMetrics = await Metric.aggregate([
      {
        $match: {
          createdAt: { $gte: timeFilter },
          metricSchemaVersion: 2,
          $or: [{ incomingThroughputBps: { $type: 'number' } }, { outgoingThroughputBps: { $type: 'number' } }],
        },
      },
      { $group: {
          _id: {
            device: '$device',
            interfaceId: '$interfaceId',
            measurementSource: '$measurementSource',
            source: '$source',
            sourceProtocol: '$sourceProtocol',
            unit: '$unit',
          },
          avgIncoming: { $avg: "$incomingThroughputBps" },
          avgOutgoing: { $avg: "$outgoingThroughputBps" },
          sampleCount: { $sum: 1 },
          latestCreatedAt: { $max: '$createdAt' },
        }
      },
      { $sort: { latestCreatedAt: -1 } },
      { $limit: 100 },
      {
        $project: {
          _id: '$_id.device',
          interfaceId: '$_id.interfaceId',
          measurementSource: '$_id.measurementSource',
          source: '$_id.source',
          sourceProtocol: '$_id.sourceProtocol',
          unit: '$_id.unit',
          avgIncoming: 1,
          avgOutgoing: 1,
          sampleCount: 1,
          latestCreatedAt: 1,
        },
      },
    ]);

    res.json(latestMetrics);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const { computeFleetAnalytics } = require('../services/anomalyDetectionService');

const getFleet = async (req, res) => {
  try {
    const devices = await Device.find({}).lean();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentMetrics = await Metric.find({ createdAt: { $gte: oneHourAgo } }).lean();

    const analytics = computeFleetAnalytics(devices, recentMetrics);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const getReliability = async (req, res) => {
  try {
    const allowedRanges = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
    const range = req.query.range || '24h';
    if (!Object.prototype.hasOwnProperty.call(allowedRanges, range)) {
      return res.status(400).json({ message: 'Range must be one of 24h, 7d, or 30d' });
    }
    const filter = { createdAt: { $gte: new Date(Date.now() - allowedRanges[range] * 60 * 60 * 1000) } };
    if (req.query.device) {
      if (!mongoose.Types.ObjectId.isValid(req.query.device)) {
        return res.status(400).json({ message: 'Invalid device ID' });
      }
      filter.device = req.query.device;
    }
    const metrics = await Metric.find(filter)
      .select('device status createdAt availability')
      .sort({ createdAt: 1 })
      .limit(10000)
      .lean();
    const grouped = new Map();
    for (const metric of metrics) {
      const key = String(metric.device);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ status: metric.status, at: metric.createdAt });
    }
    const devices = await Device.find({ _id: { $in: [...grouped.keys()] } }).select('name ipAddress').lean();
    const deviceMap = new Map(devices.map((device) => [String(device._id), device]));
    return res.json([...grouped.entries()].map(([deviceId, events]) => ({
      device: deviceMap.get(deviceId) || { _id: deviceId },
      ...calculateReliability(events, { start: filter.createdAt.$gte, end: new Date() }),
    })));
  } catch (error) {
    console.error('Reliability analytics failed:', error.name || 'UnknownError');
    return res.status(500).json({ message: 'Unable to calculate reliability analytics' });
  }
};

module.exports = { getPerformance, getTraffic, getFleet, getReliability };
