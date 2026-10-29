const mongoose = require('mongoose');

const metricSchema = new mongoose.Schema({
  device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true },
  latency: { type: Number },
  packetLoss: { type: Number },
  status: { type: String, enum: ['UP', 'DOWN', 'WARNING'] },
  cpuUtilization: { type: Number },
  memoryUtilization: { type: Number },
  incomingTraffic: { type: Number },
  collectionStatus: { type: String, enum: ['success', 'timeout', 'unreachable', 'unsupported', 'error', 'simulated'], default: 'success' },
  errorMessage: { type: String },
  measurementSource: { type: String, enum: ['real', 'simulated'], default: 'real' },
  snmp: {
    sysUpTime: { type: Number },
    ifIndex: { type: Number },
    inOctets: { type: Number },
    outOctets: { type: Number },
    inDelta: { type: Number },
    outDelta: { type: Number },
    elapsedSeconds: { type: Number },
    inBps: { type: Number },
    outBps: { type: Number },
  },
}, { timestamps: true });

// Add index on timestamps for fast querying of historical data
metricSchema.index({ device: 1, createdAt: -1 });

module.exports = mongoose.model('Metric', metricSchema);
