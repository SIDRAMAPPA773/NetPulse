const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const DiscoveryJob = require('../models/DiscoveryJob');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const { isValidIPv4 } = require('../utils/ipValidation');
const { isValidIPv6 } = require('../utils/ipv6Validation');
const { createDeviceMonitoringSummary } = require('../utils/deviceMonitoring');
const networkInterfaceService = require('../utils/networkInterfaceService');
const { synchronizeConnectedInterfaces, isFreshInterfaceAuthorization } = require('../services/interfaceAuthorizationService');
const {
  runDiscoveryForSubnet,
  cancelDiscoveryJob,
  cancelDiscoveryForSubnet,
} = require('../services/discoveryService');
const {
  authorizeMonitoringDevice,
  findSubnetForIp,
} = require('../utils/subnetAuthorization');
const {
  MAX_DISCOVERY_HOSTS,
  parseAllowlist,
  getApprovedSubnetDiscoveryHosts,
} = require('../utils/networkSafety');
const {
  getNetworkAuthorizationPolicy,
  getEffectiveDiscoveryAuthorizationMode,
} = require('../utils/networkAuthorizationPolicy');
const { encryptCredential } = require('../utils/snmpCredentialCrypto');
const { testDeviceTelemetry } = require('../services/monitoringEngine');
const { collectPassiveIntelligence, syncPassiveInventory, getLastPassiveSyncAt } = require('../services/passiveIntelligenceService');
const { recordAuditEvent } = require('../utils/auditLogger');

const publicDevice = (device) => {
  const result = device.toObject ? device.toObject() : { ...device };
  delete result.snmpCommunity;
  delete result.snmpAuthKey;
  delete result.snmpPrivKey;
  return result;
};

const getDevices = async (req, res) => {
  try {
    const filter = {};
    const tier = req.query?.tier;
    if (tier === 'authorized') {
      filter.isPassiveOnly = { $ne: true };
    } else if (tier === 'observed') {
      filter.$or = [{ isPassiveOnly: true }, { monitoringTier: 'observed' }];
    }

    const devices = await Device.find(filter)
      .select('-snmpCommunity -snmpAuthKey -snmpPrivKey')
      .sort({ name: 1 })
      .limit(500);
    if (devices.length === 0) return res.json([]);
    const [approvedSubnets, networkPolicySetting, simulationSetting] = await Promise.all([
      Subnet.find({ status: 'active', approvalStatus: 'approved' }).lean(),
      Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
      Setting.findOne({ key: 'SIMULATION_MODE' }),
    ]);
    const networkAuthorizationPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
    const measurementSource = !simulationSetting
      || simulationSetting.value === true
      || simulationSetting.value === 'true'
      ? 'simulated'
      : 'real';

    const deviceIds = devices.map((device) => device._id);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [metricSummaries, successfulMeasurements, alertCounts] = await Promise.all([
      Metric.aggregate([
        {
          $match: {
            device: { $in: deviceIds },
            measurementSource,
            createdAt: { $gte: since },
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$device',
            latestMetric: {
              $first: {
                latency: '$latency',
                packetLoss: '$packetLoss',
                availability: '$availability',
                availabilityStatus: '$availabilityStatus',
                collectionStatus: '$collectionStatus',
                reasonUnavailable: '$reasonUnavailable',
                status: '$status',
                monitoringMode: '$monitoringMode',
                incomingTraffic: '$incomingThroughputBps',
                outgoingTraffic: '$outgoingThroughputBps',
                measurementSource: '$measurementSource',
                createdAt: '$createdAt',
                derived: '$derived',
                hardware: '$hardware',
                health: '$health',
                reachability: '$reachability',
              },
            },
            recentLatency: { $push: '$latency' },
          },
        },
        { $project: { latestMetric: 1, recentLatency: { $slice: ['$recentLatency', 10] } } },
      ]),
      Metric.aggregate([
        {
          $match: {
            device: { $in: deviceIds },
            availabilityStatus: 'available',
            measurementSource: 'real',
            validity: 'valid',
            'reachability.isReachable': true,
            collectionStatus: { $in: ['success', 'timeout'] },
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$device',
            latestSuccessfulMeasurement: {
              $first: {
                createdAt: '$createdAt',
                measurementSource: '$measurementSource',
                monitoringMode: '$monitoringMode',
              },
            },
          },
        },
      ]),
      Alert.aggregate([
        { $match: { device: { $in: deviceIds }, status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } } },
        { $group: { _id: { device: '$device', severity: '$severity' }, count: { $sum: 1 } } },
      ]),
    ]);

    const metricsByDevice = new Map(metricSummaries.map((summary) => [String(summary._id), summary]));
    const successfulMeasurementsByDevice = new Map(successfulMeasurements.map(
      (summary) => [String(summary._id), summary.latestSuccessfulMeasurement],
    ));
    const monitoringAllowlist = parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST);
    const alertsByDevice = new Map();
    for (const summary of alertCounts) {
      const deviceKey = String(summary._id.device);
      const counts = alertsByDevice.get(deviceKey) || {};
      counts[summary._id.severity] = summary.count;
      alertsByDevice.set(deviceKey, counts);
    }
    res.json(devices.map((device) => {
      const metricSummary = metricsByDevice.get(String(device._id));
      const alertCountsForDevice = alertsByDevice.get(String(device._id)) || {};
      return {
        ...createDeviceMonitoringSummary(
          publicDevice(device),
          metricSummary?.latestMetric || null,
          monitoringAllowlist,
          successfulMeasurementsByDevice.get(String(device._id)) || null,
          approvedSubnets,
          networkAuthorizationPolicy.mode,
          networkAuthorizationPolicy.autoAuthorizeInterfaces,
        ),
        recentLatency: (metricSummary?.recentLatency || []).reverse(),
        alertCounts: alertCountsForDevice,
        activeAlertCount: Object.values(alertCountsForDevice).reduce((total, count) => total + count, 0),
      };
    }));
  } catch (error) {
    if (typeof res.status === 'function') {
      res.status(500).json({ message: 'Server Error' });
    } else {
      res.json({ message: 'Server Error' });
    }
  }
};

const getNetworkInterfaces = async (req, res) => {
  try {
    const detected = await networkInterfaceService.detectNetworkInterfaces();
    const discoveryAllowlist = parseAllowlist(process.env.DISCOVERY_ALLOWLIST);
    const [registeredSubnets, authorizationSetting, networkPolicySetting] = await Promise.all([
      Subnet.find({}).lean(),
      Setting.findOne({ key: 'DISCOVERY_AUTHORIZATION_MODE' }),
      Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
    ]);
    const networkPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
    const authorizationMode = getEffectiveDiscoveryAuthorizationMode(
      networkPolicySetting?.value,
      authorizationSetting?.value,
    );
    const interfaces = detected.map((networkInterface) => {
      const subnet = registeredSubnets.find((entry) => entry.cidr === networkInterface.discoveryCidr);
      const eligibility = networkInterfaceService.getDiscoveryInterfaceEligibility(networkInterface);
      const autoAuthorizationEligibility = networkInterfaceService.getPolicyEligibleInterface(networkInterface, networkPolicy);
      let authorizationStatus = eligibility.state;
      let authorizationReason = eligibility.reason;
      let hosts = null;
      if (eligibility.state === 'excluded') {
        authorizationStatus = 'excluded';
      } else if (subnet?.status === 'disabled') {
        authorizationStatus = 'disabled';
        authorizationReason = 'Subnet is disabled in Subnet Management';
      } else if (subnet?.approvalStatus === 'pending') {
        authorizationStatus = 'pending_approval';
        authorizationReason = 'Subnet registration is waiting for administrator approval';
      } else if (subnet?.status === 'active' && subnet.approvalStatus === 'approved') {
        const approval = subnet.authorizationSource === 'interface_policy' && !networkPolicy.autoAuthorizeInterfaces
          ? { error: 'INTERFACE_POLICY_DISABLED' }
          : isFreshInterfaceAuthorization(subnet)
          ? getApprovedSubnetDiscoveryHosts(subnet, discoveryAllowlist, authorizationMode)
          : { error: 'INTERFACE_NOT_CONNECTED' };
        if (approval.error === 'NOT_ALLOWLISTED') {
          authorizationStatus = 'environment_restricted';
          authorizationReason = 'The legacy discovery policy requires DISCOVERY_ALLOWLIST membership';
        } else if (approval.error === 'INTERFACE_NOT_CONNECTED') {
          authorizationStatus = 'interface_disconnected';
          authorizationReason = 'The administrator-authorized interface is no longer confirmed connected';
        } else if (approval.error === 'INTERFACE_POLICY_DISABLED') {
          authorizationStatus = 'interface_policy_disabled';
          authorizationReason = 'Automatic connected-interface authorization is disabled in administrator policy';
        } else if (approval.error) {
          authorizationStatus = 'excluded';
          authorizationReason = approval.error === 'EXCEEDS_MAX'
            ? `Subnet exceeds the ${MAX_DISCOVERY_HOSTS}-host discovery limit`
            : 'Subnet is invalid or not eligible for discovery';
        } else {
          authorizationStatus = 'authorized';
          authorizationReason = null;
          hosts = approval.hosts;
        }
      } else if (!subnet && autoAuthorizationEligibility.eligible) {
        authorizationStatus = 'eligible_for_auto_authorization';
        authorizationReason = 'This connected interface is within the configured automatic authorization scope; synchronization will register it without starting discovery';
      }
      return {
        ...networkInterface,
        discoveryApproved: authorizationStatus === 'authorized',
        subnetId: subnet ? String(subnet._id) : null,
        discoveryHostCount: hosts?.length ?? eligibility.hostCount ?? null,
        authorizationStatus,
        authorizationReason,
        discoveryApprovalReason: authorizationReason,
        automaticAuthorizationEligible: autoAuthorizationEligibility.eligible,
        automaticAuthorizationReason: autoAuthorizationEligibility.reason,
        canRegisterSubnet: !subnet && !autoAuthorizationEligibility.eligible && (
          eligibility.state === 'eligible_for_authorization'
          || eligibility.state === 'review_required'
        ),
      };
    });
    res.json({ interfaces });
  } catch (error) {
    console.error('Network interface detection failed:', error);
    res.status(500).json({ message: 'Unable to detect network interfaces' });
  }
};

const synchronizeNetworkInterfaces = async (req, res) => {
  try {
    const result = await synchronizeConnectedInterfaces({ trigger: 'admin-request' });
    res.json(result);
  } catch (error) {
    console.error('Connected interface authorization sync failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to synchronize connected network interfaces' });
  }
};

const getDeviceById = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id)
      .select('-snmpCommunity -snmpAuthKey -snmpPrivKey +telemetryDiagnostics');
    if (device) {
      const [approvedSubnets, networkPolicySetting, simulationSetting] = await Promise.all([
        Subnet.find({ status: 'active', approvalStatus: 'approved' }).lean(),
        Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
        Setting.findOne({ key: 'SIMULATION_MODE' }),
      ]);
      const networkAuthorizationPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
      const measurementSource = !simulationSetting
        || simulationSetting.value === true
        || simulationSetting.value === 'true'
        ? 'simulated'
        : 'real';
      const [latestCollection, latestSuccessfulMeasurement] = await Promise.all([
        Metric.findOne({ device: device._id, measurementSource })
          .sort({ createdAt: -1 })
          .select('createdAt measurementSource collectionStatus availabilityStatus validity reasonUnavailable latency rttMin rttMax jitter packetLoss cpuUtilization memoryUtilization incomingThroughputBps outgoingThroughputBps interfaceId derived hardware health reachability tcp dns snmp telemetryChecks')
          .lean(),
        Metric.findOne({
          device: device._id,
          availabilityStatus: 'available',
          measurementSource: 'real',
          validity: 'valid',
          'reachability.isReachable': true,
          collectionStatus: { $in: ['success', 'timeout'] },
        })
          .sort({ createdAt: -1 })
          .select('createdAt measurementSource monitoringMode')
          .lean(),
      ]);
      const monitoringSummary = createDeviceMonitoringSummary(
        publicDevice(device),
        latestCollection,
        parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST),
        latestSuccessfulMeasurement,
        approvedSubnets,
        networkAuthorizationPolicy.mode,
        networkAuthorizationPolicy.autoAuthorizeInterfaces,
      );
      res.json({
        ...monitoringSummary,
        latestCollection,
        latestSuccessfulMeasurement,
      });
    } else {
      res.status(404).json({ message: 'Device not found' });
    }
  } catch (error) {
    if (typeof res.status === 'function') {
      res.status(500).json({ message: 'Server Error' });
    } else {
      res.json({ message: 'Server Error' });
    }
  }
};

const createDevice = async (req, res) => {
  try {
    const {
      name,
      ipAddress,
      macAddress,
      hostname,
      vendor,
      type,
      location,
      description,
      operatingSystem,
      ipv6Address,
      monitoringMethod,
      pollingInterval,
      snmpCommunity,
      snmpVersion,
      snmpInterfaceIndex,
      snmpSecurityLevel,
      snmpSecurityName,
      snmpAuthProtocol,
      snmpAuthKey,
      snmpPrivProtocol,
      snmpPrivKey,
      snmpContext,
    } = req.body;

    if (!isValidIPv4(ipAddress) && !isValidIPv6(ipAddress)) {
      return res.status(400).json({ message: 'A valid IPv4 or IPv6 address is required' });
    }
    if (pollingInterval !== undefined && (
      !Number.isInteger(Number(pollingInterval)) ||
      Number(pollingInterval) < 10 ||
      Number(pollingInterval) > 3600
    )) {
      return res.status(400).json({ message: 'Polling interval must be between 10 and 3600 seconds' });
    }
    if (snmpInterfaceIndex !== undefined && (
      !Number.isInteger(Number(snmpInterfaceIndex)) || Number(snmpInterfaceIndex) < 1
    )) {
      return res.status(400).json({ message: 'SNMP interface index must be a positive integer' });
    }

    const deviceExists = await Device.findOne({ ipAddress });
    if (deviceExists) {
      return res.status(400).json({ message: 'Device with this IP already exists' });
    }

    const device = new Device({
      name,
      ipAddress,
      macAddress,
      hostname,
      vendor,
      type: type || 'other',
      location,
      description,
      operatingSystem,
      ipv6Address,
      monitoringMethod: monitoringMethod || 'icmp',
      pollingInterval: pollingInterval === undefined ? 30 : Number(pollingInterval),
      snmpCommunity: encryptCredential(snmpCommunity),
      snmpVersion: snmpVersion || '2c',
      snmpInterfaceIndex: snmpInterfaceIndex === undefined ? undefined : Number(snmpInterfaceIndex),
      snmpSecurityLevel: snmpSecurityLevel || 'noAuthNoPriv',
      snmpSecurityName,
      snmpAuthProtocol: snmpAuthProtocol || 'sha',
      snmpAuthKey: encryptCredential(snmpAuthKey),
      snmpPrivProtocol: snmpPrivProtocol || 'aes',
      snmpPrivKey: encryptCredential(snmpPrivKey),
      snmpContext,
    });

    const createdDevice = await device.save();
    res.status(201).json(publicDevice(createdDevice));
  } catch (error) {
    if (error.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_MISSING'
      || error.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_INVALID') {
      return res.status(503).json({ message: error.message });
    }
    if (error.code === 'SNMP_CREDENTIAL_INVALID') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateDevice = async (req, res) => {
  try {
    const {
      name,
      ipAddress,
      macAddress,
      hostname,
      vendor,
      type,
      location,
      description,
      operatingSystem,
      ipv6Address,
      monitoringMethod,
      monitoringStatus,
      enrollmentStatus,
      pollingInterval,
      snmpCommunity,
      snmpVersion,
      snmpInterfaceIndex,
      snmpSecurityLevel,
      snmpSecurityName,
      snmpAuthProtocol,
      snmpAuthKey,
      snmpPrivProtocol,
      snmpPrivKey,
      snmpContext,
    } = req.body;

    if (ipAddress !== undefined && !isValidIPv4(ipAddress) && !isValidIPv6(ipAddress)) {
      return res.status(400).json({ message: 'A valid IPv4 or IPv6 address is required' });
    }
    if (pollingInterval !== undefined && (
      !Number.isInteger(Number(pollingInterval)) ||
      Number(pollingInterval) < 10 ||
      Number(pollingInterval) > 3600
    )) {
      return res.status(400).json({ message: 'Polling interval must be between 10 and 3600 seconds' });
    }
    if (snmpInterfaceIndex !== undefined && (
      !Number.isInteger(Number(snmpInterfaceIndex)) || Number(snmpInterfaceIndex) < 1
    )) {
      return res.status(400).json({ message: 'SNMP interface index must be a positive integer' });
    }
    if (monitoringStatus !== undefined && typeof monitoringStatus !== 'boolean') {
      return res.status(400).json({ message: 'monitoringStatus must be a boolean' });
    }
    if (enrollmentStatus !== undefined && !['pending', 'approved'].includes(enrollmentStatus)) {
      return res.status(400).json({ message: 'enrollmentStatus must be pending or approved' });
    }

    const device = await Device.findById(req.params.id)
      .select('+snmpCommunity +snmpAuthKey +snmpPrivKey +telemetryDiagnostics');
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    device.name = name || device.name;
    device.ipAddress = ipAddress || device.ipAddress;
    if (macAddress !== undefined) device.macAddress = macAddress;
    if (hostname !== undefined) device.hostname = hostname;
    if (vendor !== undefined) device.vendor = vendor;
    if (type !== undefined) device.type = type;
    if (location !== undefined) device.location = location;
    if (description !== undefined) device.description = description;
    if (operatingSystem !== undefined) device.operatingSystem = operatingSystem;
    if (ipv6Address !== undefined) device.ipv6Address = ipv6Address;
    if (monitoringMethod !== undefined) device.monitoringMethod = monitoringMethod;
    const previousMonitoringStatus = device.monitoringStatus;
    const previousEnrollmentStatus = device.enrollmentStatus;
    if (monitoringStatus !== undefined) {
      device.monitoringStatus = monitoringStatus;
      if (!device.monitoringStatus) {
        device.status = 'UNKNOWN';
        device.consecutiveFailureCount = 0;
        device.consecutiveRecoveryCount = 0;
      }
    }
    if (enrollmentStatus !== undefined) device.enrollmentStatus = enrollmentStatus;
    if (pollingInterval !== undefined) device.pollingInterval = Number(pollingInterval);
    if (snmpCommunity !== undefined) device.snmpCommunity = encryptCredential(snmpCommunity);
    if (snmpVersion !== undefined) device.snmpVersion = snmpVersion;
    if (snmpInterfaceIndex !== undefined) device.snmpInterfaceIndex = Number(snmpInterfaceIndex);
    if (snmpSecurityLevel !== undefined) device.snmpSecurityLevel = snmpSecurityLevel;
    if (snmpSecurityName !== undefined) device.snmpSecurityName = snmpSecurityName;
    if (snmpAuthProtocol !== undefined) device.snmpAuthProtocol = snmpAuthProtocol;
    if (snmpAuthKey) device.snmpAuthKey = encryptCredential(snmpAuthKey);
    if (snmpPrivProtocol !== undefined) device.snmpPrivProtocol = snmpPrivProtocol;
    if (snmpPrivKey) device.snmpPrivKey = encryptCredential(snmpPrivKey);
    if (snmpContext !== undefined) device.snmpContext = snmpContext;
    const snmpConfigurationChanged = [
      'monitoringMethod',
      'snmpCommunity',
      'snmpVersion',
      'snmpInterfaceIndex',
      'snmpSecurityLevel',
      'snmpSecurityName',
      'snmpAuthProtocol',
      'snmpAuthKey',
      'snmpPrivProtocol',
      'snmpPrivKey',
      'snmpContext',
    ].some((path) => device.isModified(path));
    if (snmpConfigurationChanged) {
      const pendingReason = 'SNMP configuration changed; run Test Telemetry to refresh collector status';
      device.telemetryDiagnostics = {
        status: 'NOT_TESTED',
        reason: pendingReason,
        snmpVersion: device.snmpVersion,
        collectedAt: null,
        checks: [],
        interfaces: [],
        collectors: {
          cpu: { status: 'PENDING', reason: pendingReason },
          memory: { status: 'PENDING', reason: pendingReason },
          temperature: { status: 'PENDING', reason: pendingReason },
          uptime: { status: 'PENDING', reason: pendingReason },
          interface: { status: device.snmpInterfaceIndex ? 'PENDING' : 'NOT_CONFIGURED', reason: pendingReason },
          agent: { status: 'NOT_CONFIGURED', reason: 'No authenticated Windows or Linux host exporter is configured' },
        },
      };
    }

    if (device.monitoringStatus && device.enrollmentStatus === 'approved') {
      const [approvedSubnets, networkPolicySetting] = await Promise.all([
        Subnet.find({ status: 'active', approvalStatus: 'approved' }).lean(),
        Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
      ]);
      const networkAuthorizationPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
      const authorization = authorizeMonitoringDevice(
        device,
        approvedSubnets,
        parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST),
        {
          authorizationMode: networkAuthorizationPolicy.mode,
          autoAuthorizeInterfaces: networkAuthorizationPolicy.autoAuthorizeInterfaces,
        },
      );
      if (!authorization.authorized) {
        return res.status(403).json({ message: authorization.reason, code: authorization.code });
      }
    }
    if (Array.isArray(req.body.configuredTcpPorts)) {
      device.configuredTcpPorts = req.body.configuredTcpPorts
        .filter((p) => Number.isInteger(Number(p.port)) && Number(p.port) >= 1 && Number(p.port) <= 65535)
        .slice(0, 10)
        .map((p) => ({
          port: Number(p.port),
          serviceName: p.serviceName || undefined,
          enabled: p.enabled !== false,
        }));
    }
    if (req.body.gateway !== undefined) device.gateway = req.body.gateway;
    if (req.body.monitoringTier !== undefined) device.monitoringTier = req.body.monitoringTier;
    if (req.body.isPassiveOnly !== undefined) device.isPassiveOnly = req.body.isPassiveOnly;

    let updatedDevice = await device.save();
    await recordAuditEvent({
      action: 'DEVICE_UPDATED',
      category: 'DEVICE',
      userId: req.user?._id,
      targetId: device._id,
      targetName: device.name,
      details: { ipAddress: device.ipAddress, monitoringStatus: device.monitoringStatus, monitoringTier: device.monitoringTier },
    });
    if (
      (
        (previousEnrollmentStatus !== 'approved' && device.enrollmentStatus === 'approved')
        || (previousMonitoringStatus !== true && device.monitoringStatus)
      )
      && device.monitoringStatus
      && device.monitoringMethod === 'snmp'
    ) {
      const diagnostic = await testDeviceTelemetry(device);
      const snmpData = diagnostic.snmp || {};
      device.telemetryDiagnostics = {
        status: diagnostic.status || diagnostic.errorCode || 'UNAVAILABLE',
        reason: diagnostic.reason || diagnostic.message || null,
        snmpVersion: diagnostic.snmpVersion || device.snmpVersion,
        collectedAt: diagnostic.collectedAt || new Date(),
        collectionDurationMs: diagnostic.collectionDurationMs || null,
        checks: snmpData.oidChecks || [],
        interfaces: snmpData.interfaces || [],
        interfaceDiscoveryErrors: snmpData.interfaceDiscoveryErrors || [],
      };
      updatedDevice = await device.save();
    }
    if (monitoringStatus !== undefined || enrollmentStatus !== undefined) {
      console.info(JSON.stringify({
        event: 'device.monitoring-authorization-updated',
        actorId: String(req.user._id),
        deviceId: String(device._id),
        monitoringStatus: device.monitoringStatus,
        enrollmentStatus: device.enrollmentStatus,
        previousMonitoringStatus,
        previousEnrollmentStatus,
        at: new Date().toISOString(),
      }));
    }
    res.json(publicDevice(updatedDevice));
  } catch (error) {
    if (error.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_MISSING'
      || error.code === 'SNMP_CREDENTIAL_ENCRYPTION_KEY_INVALID') {
      return res.status(503).json({ message: error.message });
    }
    if (error.code === 'SNMP_CREDENTIAL_INVALID') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server Error' });
  }
};

const deleteDevice = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (device) {
      await Device.deleteOne({ _id: req.params.id });
      res.json({ message: 'Device removed' });
    } else {
      res.status(404).json({ message: 'Device not found' });
    }
  } catch (error) {
    if (typeof res.status === 'function') {
      res.status(500).json({ message: 'Server Error' });
    } else {
      res.json({ message: 'Server Error' });
    }
  }
};

const discoverLocalDevices = async (req, res) => {
  try {
    const body = req.body || {};
    if ((!body.subnetId || typeof body.subnetId !== 'string') && typeof body.cidr !== 'string') {
      return res.status(400).json({ message: 'An approved subnetId or canonical CIDR is required' });
    }
    if (body.subnetId && !/^[a-f\d]{24}$/i.test(body.subnetId)) {
      return res.status(400).json({ message: 'Invalid subnet ID' });
    }
    const subnet = body.subnetId
      ? await Subnet.findById(body.subnetId)
      : await Subnet.findOne({ cidr: body.cidr });
    if (!subnet || subnet.status !== 'active' || subnet.approvalStatus !== 'approved') {
      return res.status(403).json({ message: 'Only active, administrator-approved subnets are eligible for discovery' });
    }
    if (body.cidr !== undefined && body.cidr !== subnet.cidr) {
      return res.status(400).json({ message: 'Requested CIDR does not match the selected subnet record' });
    }
    if (body.resolveDns !== undefined && typeof body.resolveDns !== 'boolean') {
      return res.status(400).json({ message: 'resolveDns must be a boolean' });
    }
    if (body.checkServices !== undefined && typeof body.checkServices !== 'boolean') {
      return res.status(400).json({ message: 'checkServices must be a boolean' });
    }
    const ports = body.ports === undefined ? [22, 53, 80, 443, 3389] : body.ports;
    if (!Array.isArray(ports) || ports.length > 5 || ports.some((port) => (
      !Number.isInteger(port) || ![22, 53, 80, 443, 3389].includes(port)
    ))) {
      return res.status(400).json({ message: 'Only the configured bounded discovery ports may be checked' });
    }

    console.info(JSON.stringify({
      event: 'discovery.authorized',
      subnetId: String(subnet._id),
      cidr: subnet.cidr,
      actorId: String(req.user._id),
      trigger: 'manual',
      at: new Date().toISOString(),
    }));

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const result = await runDiscoveryForSubnet({
      subnetId: subnet._id,
      requestedBy: req.user._id,
      trigger: 'manual',
      options: {
        resolveDns: body.resolveDns === true,
        checkServices: body.checkServices === true,
        ports,
      },
      signal: controller.signal,
    });
    if (!res.writableEnded && !res.destroyed) res.json(result);
  } catch (error) {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (statusCode === 500) console.error('Discovery request failed:', error.name || 'UnknownError');
    if (!res.headersSent) res.status(statusCode).json({
      message: statusCode === 500 ? 'Unable to complete approved subnet discovery' : error.message,
    });
  }
};

const cancelDiscovery = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(400).json({ message: 'Invalid discovery job ID' });
    }
    const result = await cancelDiscoveryJob(req.params.id);
    if (result.error === 'NOT_FOUND') return res.status(404).json({ message: 'Discovery job not found' });
    if (result.error === 'NOT_RUNNING') return res.status(409).json({ message: 'Discovery job is not running' });
    console.info(JSON.stringify({
      event: 'discovery.cancel-requested',
      jobId: String(result.job._id),
      actorId: String(req.user._id),
      at: new Date().toISOString(),
    }));
    res.json({ message: 'Discovery cancellation requested', jobId: String(result.job._id) });
  } catch (error) {
    console.error('Discovery cancellation failed:', error.name || 'UnknownError');
    res.status(500).json({ message: 'Unable to cancel discovery job' });
  }
};

const getDiscoveryJobs = async (req, res) => {
  try {
    const jobs = await DiscoveryJob.find({})
      .sort({ startedAt: -1 })
      .limit(20)
      .select('cidr subnet trigger status totalHosts checkedHosts respondingHosts enrolledCount pendingApprovalCount duplicateCount results startedAt finishedAt errorMessage')
      .lean();
    res.json(jobs);
  } catch (error) {
    console.error('Discovery history query failed:', error);
    res.status(500).json({ message: 'Unable to load discovery history' });
  }
};

const enrollMultipleDevices = async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices) || devices.length === 0 || devices.length > MAX_DISCOVERY_HOSTS) {
      return res.status(400).json({ message: 'No devices provided' });
    }

    const approvedSubnets = await Subnet.find({ status: 'active', approvalStatus: 'approved' }).lean();
    const created = [];
    for (const item of devices) {
      if (!item || (!isValidIPv4(item.ipAddress) && !isValidIPv6(item.ipAddress))) {
        return res.status(400).json({ message: 'Every enrolled device must have a valid IP address' });
      }
      const subnet = findSubnetForIp(item.ipAddress, approvedSubnets);
      if (!subnet || (item.subnetId && String(item.subnetId) !== String(subnet._id))) {
        return res.status(403).json({ message: 'Every enrolled device must belong to its active, approved subnet' });
      }
      const exists = await Device.findOne({ ipAddress: item.ipAddress });
      if (!exists) {
        const newDev = await Device.create({
          name: item.name || item.hostname || `Device ${item.ipAddress}`,
          ipAddress: item.ipAddress,
          macAddress: item.macAddress || null,
          hostname: item.hostname || null,
          vendor: item.vendor || 'Unknown',
          type: item.type || 'switch',
          operatingSystem: item.operatingSystem || 'Unknown',
          location: item.location || 'Local Subnet',
          description: item.description || 'Auto-discovered hardware node',
          monitoringMethod: item.monitoringMethod || 'icmp',
          reachabilityMethod: item.reachabilityMethod || 'icmp',
          enrollmentStatus: subnet.requireEnrollmentApproval !== false ? 'pending' : 'approved',
          enrollmentSource: 'discovery',
          subnet: subnet._id,
          discoverySource: item.discoverySource || item.reachabilityMethod || 'unknown',
          firstDiscoveredAt: new Date(),
          lastDiscoveredAt: new Date(),
          monitoringStatus: subnet.requireEnrollmentApproval === false && subnet.monitoringEnabled === true,
          status: item.status || 'UP',
        });
        created.push(publicDevice(newDev));
      }
    }

    res.json({ message: `Successfully enrolled ${created.length} devices`, devices: created });
  } catch (error) {
    res.status(500).json({ message: 'Error enrolling devices' });
  }
};

const getPassiveInventory = async (req, res) => {
  try {
    const snapshot = await collectPassiveIntelligence({ resolveDns: true });
    const observedRecords = await Device.find({
      $or: [{ monitoringTier: 'observed' }, { isPassiveOnly: true }],
    }).lean();
    res.json({
      ...snapshot,
      observedRecords,
      lastSyncedAt: getLastPassiveSyncAt(),
    });
  } catch (error) {
    console.error('Passive inventory query failed:', error);
    res.status(500).json({ message: 'Error retrieving passive inventory' });
  }
};

const refreshPassiveInventory = async (req, res) => {
  try {
    const result = await syncPassiveInventory();
    await recordAuditEvent({
      action: 'PASSIVE_INVENTORY_REFRESHED',
      category: 'DEVICE',
      userId: req.user?._id,
      details: { syncedCount: result.synced, changesCount: result.changes.length },
    });
    res.json(result);
  } catch (error) {
    console.error('Passive inventory sync failed:', error);
    res.status(500).json({ message: 'Error synchronizing passive inventory' });
  }
};

module.exports = {
  getDevices,
  getNetworkInterfaces,
  synchronizeNetworkInterfaces,
  getDeviceById,
  createDevice,
  updateDevice,
  deleteDevice,
  discoverLocalDevices,
  cancelDiscovery,
  getDiscoveryJobs,
  enrollMultipleDevices,
  getPassiveInventory,
  refreshPassiveInventory,
};
