const mongoose = require('mongoose');

const subnetSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  cidr: { type: String, required: true, unique: true },
  networkAddress: { type: String, required: true },
  subnetMask: { type: String, required: true },
  broadcastAddress: { type: String, required: true },
  firstUsableIp: { type: String, required: true },
  lastUsableIp: { type: String, required: true },
  totalAddressCount: { type: Number, required: true, min: 1 },
  usableHostCount: { type: Number, required: true, min: 1, max: 256 },
  description: { type: String, trim: true, maxlength: 1000, default: '' },
  location: { type: String, trim: true, maxlength: 120, default: '' },
  department: { type: String, trim: true, maxlength: 120, default: '' },
  status: { type: String, enum: ['active', 'disabled'], default: 'active', required: true },
  approvalStatus: { type: String, enum: ['pending', 'approved'], default: 'pending', required: true },
  authorizationSource: { type: String, enum: ['manual', 'interface_policy'], default: 'manual', required: true },
  interfaceName: { type: String, trim: true, maxlength: 120, default: null },
  interfaceType: { type: String, enum: ['wireless', 'ethernet', 'hotspot', 'virtual'], default: null },
  interfaceConnected: { type: Boolean, default: null },
  lastInterfaceSeenAt: { type: Date, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  overlapPermitted: { type: Boolean, default: false },
  overlapPermissionReason: { type: String, trim: true, maxlength: 500, default: '' },
  overlapPermittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  autoEnroll: { type: Boolean, default: false },
  requireEnrollmentApproval: { type: Boolean, default: true },
  monitoringEnabled: { type: Boolean, default: false },
  discoveryScheduleEnabled: { type: Boolean, default: false },
  discoveryIntervalMinutes: { type: Number, min: 15, max: 10080, default: 60 },
  lastDiscoveryAt: { type: Date, default: null },
  nextDiscoveryAt: { type: Date, default: null },
  lastDiscoveryJob: { type: mongoose.Schema.Types.ObjectId, ref: 'DiscoveryJob', default: null },
  lastDiscoveredDeviceCount: { type: Number, default: 0, min: 0 },
  scheduleConfiguredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

subnetSchema.index({ status: 1, approvalStatus: 1 });
subnetSchema.index({ discoveryScheduleEnabled: 1, nextDiscoveryAt: 1 });

module.exports = mongoose.model('Subnet', subnetSchema);
