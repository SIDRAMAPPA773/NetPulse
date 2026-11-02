const mongoose = require('mongoose');
const Subnet = require('../models/Subnet');
const Device = require('../models/Device');
const DiscoveryJob = require('../models/DiscoveryJob');
const { parseCidr, ipToNumber } = require('../utils/ipValidation');
const { MAX_DISCOVERY_HOSTS } = require('../utils/networkSafety');
const { cancelDiscoveryForSubnet } = require('../services/discoveryService');

const UNSAFE_CIDRS = [
  '0.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '224.0.0.0/4',
  '240.0.0.0/4',
].map(parseCidr);

function calculateSubnet(cidr) {
  const details = parseCidr(cidr);
  if (!details || details.cidr !== cidr) {
    return { error: 'CIDR must be a canonical IPv4 network and prefix' };
  }
  if (details.hostCount > MAX_DISCOVERY_HOSTS) {
    return { error: `Subnet exceeds the ${MAX_DISCOVERY_HOSTS}-usable-host limit` };
  }
  const first = ipToNumber(details.network);
  const last = ipToNumber(details.broadcast);
  if (UNSAFE_CIDRS.some((range) => (
    first <= ipToNumber(range.broadcast) && ipToNumber(range.network) <= last
  ))) {
    return { error: 'Subnet overlaps an unsafe special-purpose IPv4 range' };
  }

  return {
    cidr: details.cidr,
    networkAddress: details.network,
    subnetMask: details.subnetMask,
    broadcastAddress: details.broadcast,
    firstUsableIp: details.firstHost,
    lastUsableIp: details.lastHost,
    totalAddressCount: details.totalAddresses,
    usableHostCount: details.hostCount,
    rangeStart: first,
    rangeEnd: last,
  };
}

function overlaps(left, right) {
  return left.rangeStart <= right.rangeEnd && right.rangeStart <= left.rangeEnd;
}

function validateText(value, label, maxLength, required = false) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.trim().length > maxLength || (required && !value.trim())) {
    return `${label} must be ${required ? 'a non-empty string of' : 'a string up to'} ${maxLength} characters`;
  }
  return null;
}

function audit(action, req, subnet, details = {}) {
  console.info(JSON.stringify({
    event: `subnet.${action}`,
    actorId: String(req.user._id),
    subnetId: subnet ? String(subnet._id) : null,
    cidr: subnet?.cidr || details.cidr || null,
    at: new Date().toISOString(),
    ...details,
  }));
}

async function findOverlap(cidr, excludedId = null) {
  const candidate = calculateSubnet(cidr);
  const existing = await Subnet.find(excludedId ? { _id: { $ne: excludedId } } : {})
    .select('_id cidr overlapPermitted');
  return existing.find((subnet) => {
    const existingRange = calculateSubnet(subnet.cidr);
    return existingRange && overlaps(candidate, existingRange);
  }) || null;
}

const listSubnets = async (req, res) => {
  try {
    const subnets = await Subnet.find({})
      .sort({ name: 1, cidr: 1 })
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('overlapPermittedBy', 'name email')
      .lean();
    const counts = subnets.length ? await Device.aggregate([
      { $match: { subnet: { $in: subnets.map((subnet) => subnet._id) } } },
      { $group: { _id: '$subnet', count: { $sum: 1 } } },
    ]) : [];
    const countBySubnet = new Map(counts.map((entry) => [String(entry._id), entry.count]));
    res.json(subnets.map((subnet) => ({
      ...subnet,
      registeredDeviceCount: countBySubnet.get(String(subnet._id)) || 0,
    })));
  } catch (error) {
    console.error('Subnet list query failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to load registered subnets' });
  }
};

const getSubnet = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid subnet ID' });
    }
    const subnet = await Subnet.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('approvedBy', 'name email')
      .populate('overlapPermittedBy', 'name email');
    if (!subnet) return res.status(404).json({ message: 'Subnet not found' });
    res.json(subnet);
  } catch (error) {
    console.error('Subnet query failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to load subnet' });
  }
};

const createSubnet = async (req, res) => {
  try {
    const { name, cidr, description, location, department, allowOverlap, overlapPermissionReason } = req.body || {};
    if (name === undefined) return res.status(400).json({ message: 'Name is required' });
    for (const [value, label, max, required] of [
      [name, 'Name', 120, true],
      [description, 'Description', 1000, false],
      [location, 'Location', 120, false],
      [department, 'Department', 120, false],
      [overlapPermissionReason, 'Overlap permission reason', 500, false],
    ]) {
      const error = validateText(value, label, max, required);
      if (error) return res.status(400).json({ message: error });
    }
    const calculated = calculateSubnet(cidr);
    if (calculated.error) return res.status(400).json({ message: calculated.error });

    const overlap = await findOverlap(cidr);
    if (overlap && (allowOverlap !== true || (overlapPermissionReason?.trim().length || 0) < 5)) {
      return res.status(409).json({
        message: 'Subnet overlaps an existing registration; explicitly permit the overlap and provide a reason to continue',
        overlappingSubnetId: String(overlap._id),
      });
    }

    const {
      rangeStart,
      rangeEnd,
      ...subnetDetails
    } = calculated;
    const subnet = await Subnet.create({
      ...subnetDetails,
      name: name.trim(),
      description: description?.trim() || '',
      location: location?.trim() || '',
      department: department?.trim() || '',
      status: 'active',
      approvalStatus: 'pending',
      createdBy: req.user._id,
      approvedBy: null,
      approvedAt: null,
      overlapPermitted: Boolean(overlap),
      overlapPermissionReason: overlap ? overlapPermissionReason.trim() : '',
      overlapPermittedBy: overlap ? req.user._id : null,
      autoEnroll: false,
      requireEnrollmentApproval: true,
      monitoringEnabled: false,
      discoveryScheduleEnabled: false,
    });
    audit('created', req, subnet, { approvalStatus: 'pending' });
    if (overlap) audit('overlap-permitted', req, subnet, {
      overlappingSubnetId: String(overlap._id),
      reason: overlapPermissionReason.trim(),
    });
    res.status(201).json(subnet);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A subnet with this CIDR is already registered' });
    console.error('Subnet creation failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to register subnet' });
  }
};

const updateSubnet = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid subnet ID' });
    }
    const {
      name,
      cidr,
      description,
      location,
      department,
      status,
      autoEnroll,
      requireEnrollmentApproval,
      monitoringEnabled,
      discoveryScheduleEnabled,
      discoveryIntervalMinutes,
      allowOverlap,
      overlapPermissionReason,
    } = req.body || {};
    for (const [value, label, max, required] of [
      [name, 'Name', 120, true],
      [description, 'Description', 1000, false],
      [location, 'Location', 120, false],
      [department, 'Department', 120, false],
      [overlapPermissionReason, 'Overlap permission reason', 500, false],
    ]) {
      const error = validateText(value, label, max, required);
      if (error) return res.status(400).json({ message: error });
    }
    if (status !== undefined && !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ message: 'Status must be active or disabled' });
    }
    for (const [value, label] of [
      [autoEnroll, 'autoEnroll'],
      [requireEnrollmentApproval, 'requireEnrollmentApproval'],
      [monitoringEnabled, 'monitoringEnabled'],
      [discoveryScheduleEnabled, 'discoveryScheduleEnabled'],
    ]) {
      if (value !== undefined && typeof value !== 'boolean') {
        return res.status(400).json({ message: `${label} must be a boolean` });
      }
    }
    if (discoveryIntervalMinutes !== undefined && (
      !Number.isInteger(discoveryIntervalMinutes)
      || discoveryIntervalMinutes < 15
      || discoveryIntervalMinutes > 10080
    )) {
      return res.status(400).json({ message: 'Discovery interval must be between 15 and 10080 minutes' });
    }

    const subnet = await Subnet.findById(req.params.id);
    if (!subnet) return res.status(404).json({ message: 'Subnet not found' });
    const previousStatus = subnet.status;
    const previousAuthorization = {
      autoEnroll: subnet.autoEnroll,
      requireEnrollmentApproval: subnet.requireEnrollmentApproval,
      monitoringEnabled: subnet.monitoringEnabled,
      discoveryScheduleEnabled: subnet.discoveryScheduleEnabled,
      discoveryIntervalMinutes: subnet.discoveryIntervalMinutes,
    };
    const nextCidr = cidr === undefined ? subnet.cidr : cidr;
    const calculated = calculateSubnet(nextCidr);
    if (calculated.error) return res.status(400).json({ message: calculated.error });

    const cidrChanged = nextCidr !== subnet.cidr;
    let overlap = null;
    if (cidrChanged) {
      overlap = await findOverlap(nextCidr, subnet._id);
      if (overlap && (allowOverlap !== true || (overlapPermissionReason?.trim().length || 0) < 5)) {
        return res.status(409).json({
          message: 'Subnet overlaps an existing registration; explicitly permit the overlap and provide a reason to continue',
          overlappingSubnetId: String(overlap._id),
        });
      }
    }

    if (name !== undefined) subnet.name = name.trim();
    if (description !== undefined) subnet.description = description.trim();
    if (location !== undefined) subnet.location = location.trim();
    if (department !== undefined) subnet.department = department.trim();
    if (status !== undefined) subnet.status = status;
    if (cidrChanged) {
      const {
        rangeStart,
        rangeEnd,
        ...subnetDetails
      } = calculated;
      Object.assign(subnet, subnetDetails);
      subnet.approvalStatus = 'pending';
      subnet.approvedBy = null;
      subnet.approvedAt = null;
      subnet.overlapPermitted = Boolean(overlap);
      subnet.overlapPermissionReason = overlap ? overlapPermissionReason.trim() : '';
      subnet.overlapPermittedBy = overlap ? req.user._id : null;
    }
    if (status === 'active' && previousStatus === 'disabled') {
      subnet.approvalStatus = 'pending';
      subnet.approvedBy = null;
      subnet.approvedAt = null;
      subnet.discoveryScheduleEnabled = false;
      subnet.monitoringEnabled = false;
      subnet.nextDiscoveryAt = null;
    }
    if (status === 'disabled' || cidrChanged) {
      subnet.discoveryScheduleEnabled = false;
      subnet.monitoringEnabled = false;
      subnet.nextDiscoveryAt = null;
      cancelDiscoveryForSubnet(subnet._id);
    }

    if (autoEnroll !== undefined) subnet.autoEnroll = autoEnroll;
    if (requireEnrollmentApproval !== undefined) subnet.requireEnrollmentApproval = requireEnrollmentApproval;
    if (monitoringEnabled !== undefined) subnet.monitoringEnabled = monitoringEnabled;
    if (discoveryIntervalMinutes !== undefined) subnet.discoveryIntervalMinutes = discoveryIntervalMinutes;
    if (discoveryScheduleEnabled !== undefined) subnet.discoveryScheduleEnabled = discoveryScheduleEnabled;
    if (subnet.status !== 'active' || cidrChanged) {
      subnet.monitoringEnabled = false;
      subnet.discoveryScheduleEnabled = false;
      subnet.nextDiscoveryAt = null;
    }
    if (
      subnet.discoveryScheduleEnabled
      && (subnet.status !== 'active' || subnet.approvalStatus !== 'approved')
    ) {
      return res.status(409).json({ message: 'Approve and activate the subnet before enabling its discovery schedule' });
    }
    if (
      subnet.monitoringEnabled
      && (subnet.status !== 'active' || subnet.approvalStatus !== 'approved')
    ) {
      return res.status(409).json({ message: 'Approve and activate the subnet before enabling its monitoring policy' });
    }
    if (subnet.discoveryScheduleEnabled && (
      discoveryScheduleEnabled === true || discoveryIntervalMinutes !== undefined
    )) {
      subnet.scheduleConfiguredBy = req.user._id;
      subnet.nextDiscoveryAt = new Date(Date.now() + subnet.discoveryIntervalMinutes * 60_000);
    } else if (!subnet.discoveryScheduleEnabled) {
      subnet.nextDiscoveryAt = null;
    }

    if (Object.entries(previousAuthorization).some(([key, value]) => value !== subnet[key])) {
      if (discoveryScheduleEnabled !== undefined || discoveryIntervalMinutes !== undefined) {
        subnet.scheduleConfiguredBy = req.user._id;
      }
    }
    await subnet.save();
    audit('updated', req, subnet, { cidrChanged, status: subnet.status });
    if (Object.entries(previousAuthorization).some(([key, value]) => value !== subnet[key])) {
      audit('authorization-updated', req, subnet, {
        previous: previousAuthorization,
        current: {
          autoEnroll: subnet.autoEnroll,
          requireEnrollmentApproval: subnet.requireEnrollmentApproval,
          monitoringEnabled: subnet.monitoringEnabled,
          discoveryScheduleEnabled: subnet.discoveryScheduleEnabled,
          discoveryIntervalMinutes: subnet.discoveryIntervalMinutes,
        },
      });
    }
    if (status === 'disabled' && previousStatus !== 'disabled') {
      audit('disabled', req, subnet);
    }
    if (overlap) audit('overlap-permitted', req, subnet, {
      overlappingSubnetId: String(overlap._id),
      reason: overlapPermissionReason.trim(),
    });
    res.json(subnet);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'A subnet with this CIDR is already registered' });
    console.error('Subnet update failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to update subnet' });
  }
};

const approveSubnet = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid subnet ID' });
    }
    const subnet = await Subnet.findById(req.params.id);
    if (!subnet) return res.status(404).json({ message: 'Subnet not found' });
    if (subnet.status !== 'active') {
      return res.status(409).json({ message: 'Disabled subnets cannot be approved' });
    }
    if (subnet.approvalStatus === 'approved') return res.json(subnet);
    subnet.approvalStatus = 'approved';
    subnet.approvedBy = req.user._id;
    subnet.approvedAt = new Date();
    await subnet.save();
    audit('approved', req, subnet);
    res.json(subnet);
  } catch (error) {
    console.error('Subnet approval failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to approve subnet' });
  }
};

const disableSubnet = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid subnet ID' });
    }
    const subnet = await Subnet.findById(req.params.id);
    if (!subnet) return res.status(404).json({ message: 'Subnet not found' });
    if (subnet.status !== 'disabled') {
      subnet.status = 'disabled';
      subnet.monitoringEnabled = false;
      subnet.discoveryScheduleEnabled = false;
      subnet.nextDiscoveryAt = null;
      cancelDiscoveryForSubnet(subnet._id);
      await subnet.save();
      audit('disabled', req, subnet);
      audit('authorization-updated', req, subnet, {
        monitoringEnabled: false,
        discoveryScheduleEnabled: false,
      });
    }
    res.json(subnet);
  } catch (error) {
    console.error('Subnet disable failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to disable subnet' });
  }
};

const deleteSubnet = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid subnet ID' });
    }
    const subnet = await Subnet.findById(req.params.id);
    if (!subnet) return res.status(404).json({ message: 'Subnet not found' });
    const runningJob = await DiscoveryJob.exists({
      $or: [{ subnet: subnet._id }, { cidr: subnet.cidr }],
      status: 'running',
    });
    if (runningJob) return res.status(409).json({ message: 'Subnet cannot be deleted while discovery is running for its CIDR' });
    await Subnet.deleteOne({ _id: subnet._id });
    audit('deleted', req, subnet);
    res.json({ message: 'Subnet removed' });
  } catch (error) {
    console.error('Subnet deletion failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to delete subnet' });
  }
};

module.exports = {
  calculateSubnet,
  listSubnets,
  getSubnet,
  createSubnet,
  updateSubnet,
  approveSubnet,
  disableSubnet,
  deleteSubnet,
};
