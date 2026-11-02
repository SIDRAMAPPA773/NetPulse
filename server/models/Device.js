const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  ipAddress: { type: String, required: true, unique: true },
  macAddress: { type: String },
  hostname: { type: String },
  vendor: { type: String },
  type: {
    type: String,
    enum: ['router', 'switch', 'server', 'pc', 'printer', 'ap', 'other'],
    required: true,
  },
  operatingSystem: { type: String },
  ipv6Address: { type: String },
  reachabilityMethod: {
    type: String,
    enum: ['icmp', 'tcp', 'snmp', 'neighbour', 'multi', 'none'],
    default: 'none',
  },
  enrollmentStatus: { type: String, enum: ['pending', 'approved'], default: 'approved' },
  enrollmentSource: { type: String, enum: ['manual', 'discovery'], default: 'manual' },
  subnet: { type: mongoose.Schema.Types.ObjectId, ref: 'Subnet', default: null },
  collectorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Collector', default: null },
  discoverySource: { type: String, default: null },
  firstDiscoveredAt: { type: Date, default: null },
  lastDiscoveredAt: { type: Date, default: null },
  lastCollectorObservationAt: { type: Date, default: null },
  healthScore: { type: Number, default: null },
  healthStatus: {
    type: String,
    enum: ['Healthy', 'Warning', 'Critical', 'Unknown'],
    default: 'Unknown',
  },
  telemetryDiagnostics: { type: mongoose.Schema.Types.Mixed, select: false },
  location: { type: String },
  description: { type: String },
  monitoringStatus: { type: Boolean, default: true },
  monitoringMethod: { type: String, enum: ['icmp', 'snmp'], default: 'icmp' },
  pollingInterval: { type: Number, default: 30 }, // in seconds
  snmpCommunity: { type: String, select: false },
  snmpVersion: { type: String, enum: ['1', '2c', '3'], default: '2c' },
  snmpInterfaceIndex: { type: Number, min: 1 },
  snmpSecurityLevel: {
    type: String,
    enum: ['noAuthNoPriv', 'authNoPriv', 'authPriv'],
    default: 'noAuthNoPriv',
  },
  snmpSecurityName: { type: String },
  snmpAuthProtocol: {
    type: String,
    enum: ['md5', 'sha', 'sha224', 'sha256', 'sha384', 'sha512'],
    default: 'sha',
  },
  snmpAuthKey: { type: String, select: false },
  snmpPrivProtocol: {
    type: String,
    enum: ['des', 'aes', 'aes256b', 'aes256r'],
    default: 'aes',
  },
  snmpPrivKey: { type: String, select: false },
  snmpContext: { type: String },
  status: { type: String, enum: ['UP', 'DOWN', 'WARNING', 'UNREACHABLE', 'UNKNOWN'], default: 'UNKNOWN' },
  consecutiveFailureCount: { type: Number, min: 0, default: 0 },
  consecutiveRecoveryCount: { type: Number, min: 0, default: 0 },
  lastSeen: { type: Date },
}, {
  timestamps: true,
  toJSON: {
    transform: (document, result) => {
      delete result.snmpCommunity;
      delete result.snmpAuthKey;
      delete result.snmpPrivKey;
      return result;
    },
  },
});

deviceSchema.index({ subnet: 1, enrollmentStatus: 1, monitoringStatus: 1 });
deviceSchema.index({ monitoringStatus: 1, collectorId: 1 });

module.exports = mongoose.model('Device', deviceSchema);
