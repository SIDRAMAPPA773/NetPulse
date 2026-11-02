const mongoose = require('mongoose');

const collectorSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  subnet: { type: mongoose.Schema.Types.ObjectId, ref: 'Subnet', required: true },
  tokenHash: { type: String, required: true, select: false },
  status: { type: String, enum: ['active', 'revoked'], default: 'active', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  agentVersion: { type: String, default: null, maxlength: 40 },
  lastHeartbeatAt: { type: Date, default: null },
  lastReportAt: { type: Date, default: null },
  lastReportedDeviceCount: { type: Number, default: 0, min: 0, max: 256 },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });

collectorSchema.index(
  { subnet: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);
collectorSchema.index({ tokenHash: 1, status: 1 });

collectorSchema.set('toJSON', {
  transform: (document, result) => {
    delete result.tokenHash;
    return result;
  },
});

module.exports = mongoose.model('Collector', collectorSchema);
