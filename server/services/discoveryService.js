const snmp = require('net-snmp');
const Device = require('../models/Device');
const DiscoveryJob = require('../models/DiscoveryJob');
const Setting = require('../models/Setting');
const Subnet = require('../models/Subnet');
const icmpProbe = require('../utils/icmpProbe');
const { probeServices } = require('../utils/tcpProbe');
const { resolveHostname } = require('../utils/dnsProbe');
const neighbourService = require('../utils/neighbourService');
const { identifyDevice } = require('../utils/deviceIdentification');
const { evaluateReachability } = require('../utils/multiMethodReachability');
const { Semaphore, createRateLimiter } = require('../utils/safety');
const { mapDiscoveredDevices } = require('../utils/discoveryResults');
const networkInterfaceService = require('../utils/networkInterfaceService');
const {
  parseAllowlist,
  getApprovedSubnetDiscoveryHosts,
  isEmergencyStopActive,
  setEmergencyStop,
} = require('../utils/networkSafety');
const {
  getNetworkAuthorizationPolicy,
  getEffectiveDiscoveryAuthorizationMode,
} = require('../utils/networkAuthorizationPolicy');
const { isFreshInterfaceAuthorization } = require('./interfaceAuthorizationService');
const { createSnmpSession, HARDWARE_OIDS } = require('../utils/snmpHardwareCollectors');
const { transitionDeviceHealth } = require('../utils/deviceHealthState');
const socketService = require('./socketService');

const DISCOVERY_CONCURRENCY = Number.isInteger(Number(process.env.DISCOVERY_MAX_CONCURRENCY))
  ? Math.min(4, Math.max(1, Number(process.env.DISCOVERY_MAX_CONCURRENCY)))
  : 2;
const DISCOVERY_RATE_PER_SECOND = Number.isInteger(Number(process.env.DISCOVERY_MAX_PROBES_PER_SECOND))
  ? Math.min(4, Math.max(1, Number(process.env.DISCOVERY_MAX_PROBES_PER_SECOND)))
  : 2;
const activeControllers = new Map();
const lastStartedAt = new Map();
let activeJobId = null;

function isEnabled(value) {
  return value === true || value === 'true';
}

function discoveryFailure(message, status = 400) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

function identityConfidence({ macAddress, hostname, openPorts, snmpResponded, neighbourEntry }) {
  const signals = [
    Boolean(macAddress),
    Boolean(hostname),
    Boolean(openPorts?.length),
    Boolean(snmpResponded),
    Boolean(neighbourEntry),
  ].filter(Boolean).length;
  return {
    level: signals >= 4 ? 'high' : signals >= 2 ? 'medium' : 'low',
    signals,
  };
}

async function configuredSnmpIdentity(device, rateLimiter, signal) {
  if (!device || device.monitoringMethod !== 'snmp' || signal.aborted || isEmergencyStopActive()) return null;
  let session;
  try {
    session = createSnmpSession(device, { timeout: 1200, retries: 0 });
    await rateLimiter.acquire();
    if (signal.aborted || isEmergencyStopActive()) return null;
    return await new Promise((resolve) => {
      session.get([HARDWARE_OIDS.sysDescr, HARDWARE_OIDS.sysName], (error, varbinds) => {
        if (error || !varbinds) return resolve(null);
        const values = new Map(varbinds
          .filter((varbind) => !snmp.isVarbindError(varbind))
          .map((varbind) => [varbind.oid, String(varbind.value).trim()]));
        resolve({
          responded: values.size > 0,
          description: values.get(HARDWARE_OIDS.sysDescr) || null,
          name: values.get(HARDWARE_OIDS.sysName) || null,
        });
      });
    });
  } catch {
    return null;
  } finally {
    session?.close();
  }
}

async function recordSubnetDiscovery(subnet, job, deviceCount, finishedAt) {
  subnet.lastDiscoveryAt = finishedAt;
  subnet.lastDiscoveryJob = job?._id || null;
  subnet.lastDiscoveredDeviceCount = deviceCount;
  subnet.nextDiscoveryAt = subnet.discoveryScheduleEnabled
    ? new Date(finishedAt.getTime() + subnet.discoveryIntervalMinutes * 60_000)
    : null;
  await subnet.save();
}

async function runReservedDiscovery({
  subnetId,
  requestedBy,
  trigger = 'manual',
  options = {},
  signal: externalSignal = null,
}) {
  const subnet = await Subnet.findById(subnetId);
  if (!subnet || subnet.status !== 'active' || subnet.approvalStatus !== 'approved') {
    throw discoveryFailure('Only active, administrator-approved subnets are eligible for discovery', 403);
  }

  const [simulationSetting, emergencySetting, authorizationSetting, networkPolicySetting] = await Promise.all([
    Setting.findOne({ key: 'SIMULATION_MODE' }),
    Setting.findOne({ key: 'EMERGENCY_STOP' }),
    Setting.findOne({ key: 'DISCOVERY_AUTHORIZATION_MODE' }),
    Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
  ]);
  const allowlist = parseAllowlist(process.env.DISCOVERY_ALLOWLIST);
  const authorizationMode = getEffectiveDiscoveryAuthorizationMode(
    networkPolicySetting?.value,
    authorizationSetting?.value,
  );
  const networkPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
  if (subnet.authorizationSource === 'interface_policy') {
    const detectedInterfaces = await networkInterfaceService.detectNetworkInterfaces();
    const currentInterface = detectedInterfaces.find((networkInterface) => (
      networkInterface.discoveryCidr === subnet.cidr
      && networkInterfaceService.getPolicyEligibleInterface(networkInterface, networkPolicy).eligible
    ));
    if (!currentInterface || !isFreshInterfaceAuthorization(subnet)) {
      throw discoveryFailure('The administrator-authorized interface is no longer confirmed connected or within policy scope', 403);
    }
  }
  const approval = getApprovedSubnetDiscoveryHosts(subnet, allowlist, authorizationMode);
  if (approval.error) {
    throw discoveryFailure(
      approval.error === 'SUBNET_NOT_APPROVED'
        ? 'Only active, administrator-approved subnets are eligible for discovery'
        : approval.error === 'NOT_ALLOWLISTED'
          ? 'Subnet CIDR is not an exact entry in DISCOVERY_ALLOWLIST'
          : approval.error === 'UNSAFE_CIDR'
            ? 'Discovery is restricted to eligible private IPv4 subnets'
            : 'Subnet CIDR is invalid or exceeds the discovery host limit',
      approval.error === 'NOT_ALLOWLISTED' || approval.error === 'SUBNET_NOT_APPROVED' ? 403 : 400,
    );
  }

  if (!simulationSetting || isEnabled(simulationSetting.value)) {
    throw discoveryFailure('Discovery is disabled in simulation mode', 409);
  }
  const stopActive = isEnabled(emergencySetting?.value);
  setEmergencyStop(stopActive);
  if (stopActive || isEmergencyStopActive()) {
    throw discoveryFailure('Emergency stop is active; discovery is disabled', 503);
  }

  const subnetKey = String(subnet._id);
  const now = Date.now();
  const previousStart = lastStartedAt.get(subnetKey);
  if (previousStart !== undefined && now - previousStart < 60_000) {
    throw discoveryFailure('Subnet discovery cooldown is active', 429);
  }

  const existingJob = await DiscoveryJob.exists({ subnet: subnet._id, status: 'running' });
  if (existingJob) throw discoveryFailure('A discovery job is already running for this subnet', 409);

  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  activeJobId = subnetKey;
  activeControllers.set(subnetKey, controller);
  lastStartedAt.set(subnetKey, now);
  let job = null;
  let finishRecorded = false;

  try {
    job = await DiscoveryJob.create({
      cidr: approval.cidr,
      subnet: subnet._id,
      requestedBy,
      trigger,
      status: 'running',
      totalHosts: approval.hosts.length,
    });
    activeControllers.set(String(job._id), controller);

    const rateLimiter = createRateLimiter({ maxPerSecond: DISCOVERY_RATE_PER_SECOND });
    const semaphore = new Semaphore(DISCOVERY_CONCURRENCY);
    const discovered = [];
    let nextHostIndex = 0;
    let checkedHosts = 0;
    let progressWrites = Promise.resolve();
    const knownDevices = await Device.find({ ipAddress: { $in: approval.hosts } })
      .select('+snmpCommunity +snmpAuthKey +snmpPrivKey');
    const knownByIp = new Map(knownDevices.map((device) => [device.ipAddress, device]));

    let neighbourTable = new Map();
    try {
      neighbourTable = await neighbourService.getNeighbourTable();
    } catch (error) {
      console.warn('Neighbour table lookup unavailable during discovery:', error.message);
    }

    const publishProgress = () => {
      const progress = {
        jobId: String(job._id),
        subnetId: subnetKey,
        cidr: approval.cidr,
        checkedHosts,
        totalHosts: approval.hosts.length,
        respondingHosts: discovered.length,
        status: controller.signal.aborted ? 'cancelling' : 'running',
      };
      socketService.getIO().to('admins').emit('discoveryProgress', progress);
      if (checkedHosts % 8 === 0 || checkedHosts === approval.hosts.length) {
        progressWrites = progressWrites.then(() => DiscoveryJob.updateOne(
          { _id: job._id },
          { $set: { checkedHosts, respondingHosts: discovered.length } },
        ));
      }
    };

    const worker = async () => {
      while (!controller.signal.aborted && !isEmergencyStopActive()) {
        const index = nextHostIndex++;
        if (index >= approval.hosts.length) return;
        await rateLimiter.acquire();
        if (controller.signal.aborted || isEmergencyStopActive()) return;
        const release = await semaphore.acquire();
        try {
          if (controller.signal.aborted || isEmergencyStopActive()) return;
          const ipAddress = approval.hosts[index];
          let probe;
          try {
            probe = await icmpProbe.probeIcmp(ipAddress, {
              count: 1,
              timeout: 1,
              signal: controller.signal,
            });
          } catch (error) {
            console.error(`Discovery ICMP probe failed for ${ipAddress}:`, error.name || 'UnknownError');
            checkedHosts += 1;
            publishProgress();
            continue;
          }
          checkedHosts += 1;

          let tcpRes = { reachable: false, openPorts: [] };
          if (options.checkServices && !controller.signal.aborted && !isEmergencyStopActive()) {
            try {
              tcpRes = await probeServices(ipAddress, options.ports, { timeoutMs: 800 });
            } catch (error) {
              console.warn(`Discovery TCP checks failed for ${ipAddress}:`, error.name || 'UnknownError');
            }
          }
          const neighbourEntry = neighbourTable.get(ipAddress) || null;
          const snmpIdentity = await configuredSnmpIdentity(knownByIp.get(ipAddress), rateLimiter, controller.signal);
          const reachability = evaluateReachability({
            icmp: probe,
            tcp: tcpRes,
            snmp: snmpIdentity,
            neighbour: neighbourEntry,
          });

          if (reachability.isReachable) {
            let dnsRes = null;
            if (options.resolveDns && !controller.signal.aborted) {
              try {
                dnsRes = await resolveHostname(ipAddress, { timeoutMs: 1000 });
              } catch (error) {
                console.warn(`Reverse DNS lookup failed for ${ipAddress}:`, error.name || 'UnknownError');
              }
            }
            const identity = identifyDevice({
              ipAddress,
              macAddress: neighbourEntry?.macAddress || null,
              hostname: dnsRes?.hostname || snmpIdentity?.name || null,
              openPorts: tcpRes.openPorts,
              isGateway: false,
              discoverySource: reachability.confirmedMethod,
            });
            const confidence = identityConfidence({
              macAddress: identity.macAddress,
              hostname: identity.hostname,
              openPorts: tcpRes.openPorts,
              snmpResponded: snmpIdentity?.responded,
              neighbourEntry,
            });
            discovered.push({
              name: identity.hostname || `Host (${ipAddress})`,
              ipAddress,
              macAddress: identity.macAddress,
              hostname: identity.hostname,
              vendor: identity.vendor,
              type: identity.deviceType,
              operatingSystem: identity.operatingSystem || snmpIdentity?.description || 'Unknown',
              location: subnet.location || 'Approved subnet',
              description: `Discovered via ${reachability.confirmedMethod.toUpperCase()} (${reachability.reason})`,
              monitoringMethod: 'icmp',
              status: reachability.status,
              reachabilityMethod: reachability.confirmedMethod,
              discoverySource: reachability.methodsResponding.join(','),
              identityConfidence: confidence.level,
              identitySignals: confidence.signals,
              latency: probe.rttAvg ?? null,
              openPorts: tcpRes.openPorts,
              dnsStatus: dnsRes?.status || null,
              dnsResponseTimeMs: dnsRes?.responseTimeMs || null,
            });
          }
          publishProgress();
        } finally {
          release();
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, approval.hosts.length) }, worker));
    await progressWrites;

    const discoveredIps = discovered.map((device) => device.ipAddress);
    const macAddresses = discovered.map((device) => device.macAddress).filter(Boolean);
    const existing = await Device.find({
      $or: [
        { ipAddress: { $in: discoveredIps } },
        { macAddress: { $in: macAddresses } },
      ],
    })
      .select('_id ipAddress monitoringStatus enrollmentStatus status lastSeen reachabilityMethod macAddress vendor hostname subnet enrollmentSource consecutiveFailureCount consecutiveRecoveryCount');
    const existingByIp = new Map(existing.map((device) => [device.ipAddress, device]));
    const existingByMac = new Map(
      existing.filter((device) => device.macAddress)
        .map((device) => [device.macAddress.toLowerCase(), device]),
    );
    let enrolledCount = 0;
    let pendingApprovalCount = 0;
    let duplicateCount = 0;
    for (const candidate of discovered) {
      let device = existingByIp.get(candidate.ipAddress);
      const duplicateDevice = !device && candidate.macAddress
        ? existingByMac.get(candidate.macAddress.toLowerCase())
        : null;
      if (duplicateDevice) {
        candidate.isDuplicate = true;
        candidate.duplicateDeviceId = String(duplicateDevice._id);
        duplicateCount += 1;
      }
      if (!device && subnet.autoEnroll) {
        if (duplicateDevice) continue;
        const enrollmentStatus = subnet.requireEnrollmentApproval ? 'pending' : 'approved';
        device = await Device.create({
          name: candidate.name,
          ipAddress: candidate.ipAddress,
          macAddress: candidate.macAddress || undefined,
          hostname: candidate.hostname || undefined,
          vendor: candidate.vendor || 'Unknown',
          type: candidate.type || 'other',
          operatingSystem: candidate.operatingSystem || 'Unknown',
          location: candidate.location,
          description: candidate.description,
          monitoringMethod: 'icmp',
          reachabilityMethod: candidate.reachabilityMethod,
          status: candidate.status,
          enrollmentStatus,
          enrollmentSource: 'discovery',
          subnet: subnet._id,
          discoverySource: candidate.discoverySource,
          firstDiscoveredAt: new Date(),
          lastDiscoveredAt: new Date(),
          monitoringStatus: enrollmentStatus === 'approved' && subnet.monitoringEnabled === true,
        });
        existingByIp.set(candidate.ipAddress, device);
        enrolledCount += 1;
        if (enrollmentStatus === 'pending') pendingApprovalCount += 1;
      } else if (device) {
        const seenAt = new Date();
        device.status = transitionDeviceHealth(device, {
          reachable: true,
          degraded: candidate.status === 'WARNING',
        });
        device.reachabilityMethod = candidate.reachabilityMethod;
        device.lastSeen = seenAt;
        device.lastDiscoveredAt = seenAt;
        if (!device.firstDiscoveredAt) device.firstDiscoveredAt = seenAt;
        if (!device.subnet) device.subnet = subnet._id;
        if (!device.discoverySource) device.discoverySource = candidate.discoverySource;
        if (!device.macAddress && candidate.macAddress) device.macAddress = candidate.macAddress;
        if (!device.vendor || device.vendor === 'Unknown') device.vendor = candidate.vendor;
        if (!device.hostname && candidate.hostname) device.hostname = candidate.hostname;
        await device.save();
        socketService.getIO().to('admins').emit('deviceUpdated', device.toJSON());
      }
      if (device) candidate.deviceId = String(device._id);
    }

    const [approvedSubnets, networkPolicySetting] = await Promise.all([
      Subnet.find({ status: 'active', approvalStatus: 'approved' }).lean(),
      Setting.findOne({ key: 'NETWORK_AUTHORIZATION_POLICY' }),
    ]);
    const networkAuthorizationPolicy = getNetworkAuthorizationPolicy(networkPolicySetting?.value);
    const finalResults = mapDiscoveredDevices(
      discovered,
      Array.from(existingByIp.values()),
      parseAllowlist(process.env.MONITORING_TARGET_ALLOWLIST),
      approvedSubnets,
      networkAuthorizationPolicy.mode,
      networkAuthorizationPolicy.autoAuthorizeInterfaces,
    ).map((candidate) => ({
      ...candidate,
      subnetId: subnetKey,
      enrollmentStatus: candidate.enrollmentStatus || (candidate.isEnrolled ? 'approved' : 'not_enrolled'),
    }));

    const finishedAt = new Date();
    job.status = controller.signal.aborted || isEmergencyStopActive() ? 'cancelled' : 'completed';
    job.checkedHosts = checkedHosts;
    job.respondingHosts = finalResults.length;
    job.enrolledCount = enrolledCount;
    job.pendingApprovalCount = pendingApprovalCount;
    job.duplicateCount = duplicateCount;
    job.results = finalResults;
    job.finishedAt = finishedAt;
    await job.save();
    await recordSubnetDiscovery(subnet, job, finalResults.length, finishedAt);
    finishRecorded = true;
    console.info(JSON.stringify({
      event: 'discovery.completed',
      subnetId: subnetKey,
      cidr: subnet.cidr,
      trigger,
      jobId: String(job._id),
      status: job.status,
      checkedHosts,
      respondingHosts: finalResults.length,
      enrolledCount,
      duplicateCount,
      at: finishedAt.toISOString(),
    }));

    return {
      jobId: String(job._id),
      status: job.status,
      subnet: approval.cidr,
      subnetId: subnetKey,
      count: finalResults.length,
      checkedHosts,
      totalHosts: approval.hosts.length,
      enrolledCount,
      pendingApprovalCount,
      duplicateCount,
      devices: finalResults,
    };
  } catch (error) {
    if (job) {
      job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      job.finishedAt = new Date();
      job.errorMessage = 'Discovery job failed';
      await job.save();
      if (!finishRecorded) await recordSubnetDiscovery(subnet, job, 0, job.finishedAt);
    }
    throw error;
  } finally {
    externalSignal?.removeEventListener('abort', abortFromExternal);
    activeControllers.delete(subnetKey);
    if (job) activeControllers.delete(String(job._id));
    activeJobId = null;
  }
}

async function runDiscoveryForSubnet(params) {
  if (activeJobId) throw discoveryFailure('Another discovery job is already running', 409);
  activeJobId = 'starting';
  try {
    return await runReservedDiscovery(params);
  } finally {
    if (activeJobId === 'starting') activeJobId = null;
  }
}

async function cancelDiscoveryJob(jobId) {
  const job = await DiscoveryJob.findById(jobId);
  if (!job) return { error: 'NOT_FOUND' };
  if (job.status !== 'running') return { error: 'NOT_RUNNING', job };
  const controller = activeControllers.get(String(job._id)) || activeControllers.get(String(job.subnet));
  if (!controller) return { error: 'NOT_RUNNING', job };
  controller.abort();
  return { job };
}

function cancelDiscoveryForSubnet(subnetId) {
  const controller = activeControllers.get(String(subnetId));
  if (!controller) return false;
  controller.abort();
  return true;
}

module.exports = { runDiscoveryForSubnet, cancelDiscoveryJob, cancelDiscoveryForSubnet };
