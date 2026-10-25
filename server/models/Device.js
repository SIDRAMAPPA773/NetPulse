const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ipAddress: { type: String, required: true, unique: true },
  type: { type: String, enum: ['router', 'switch', 'server', 'pc', 'other'], required: true },
  location: { type: String },
  description: { type: String },
  monitoringStatus: { type: Boolean, default: true },
  monitoringMethod: { type: String, enum: ['icmp', 'snmp'], default: 'icmp' },
  pollingInterval: { type: Number, default: 30 }, // in seconds
  snmpCommunity: { type: String },
  snmpVersion: { type: String, enum: ['1', '2c', '3'], default: '2c' },
  status: { type: String, enum: ['UP', 'DOWN', 'WARNING', 'UNKNOWN'], default: 'UNKNOWN' },
  lastSeen: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Device', deviceSchema);
