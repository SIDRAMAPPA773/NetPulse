const {
  isValidIPv4,
  parseCidr,
  enumerateHosts,
  isPrivateIPv4Cidr,
} = require('./ipValidation');

const MAX_DISCOVERY_HOSTS = 256;
const DISCOVERY_AUTHORIZATION_MODES = Object.freeze({
  DUAL: 'dual',
  SUBNET_REGISTRY: 'subnet_registry',
});
let emergencyStopActive = false;

function parseAllowlist(value = '') {
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getDiscoveryAuthorizationMode(value) {
  return Object.values(DISCOVERY_AUTHORIZATION_MODES).includes(value)
    ? value
    : DISCOVERY_AUTHORIZATION_MODES.DUAL;
}

function getApprovedDiscoveryHosts(
  cidr,
  allowlist,
  maxHosts = MAX_DISCOVERY_HOSTS,
  { requireAllowlist = true } = {},
) {
  const parsed = parseCidr(cidr);
  if (!parsed || parsed.cidr !== cidr) {
    return { error: 'INVALID_CIDR' };
  }
  if (!isPrivateIPv4Cidr(parsed.cidr)) {
    return { error: 'UNSAFE_CIDR' };
  }
  if (requireAllowlist && (!Array.isArray(allowlist) || !allowlist.includes(parsed.cidr))) {
    return { error: 'NOT_ALLOWLISTED' };
  }

  const result = enumerateHosts(parsed.cidr, Math.min(maxHosts, MAX_DISCOVERY_HOSTS));
  if (!result || result.error) return { error: 'EXCEEDS_MAX', hostCount: parsed.hostCount };
  return { cidr: parsed.cidr, hosts: result.hosts };
}

function getApprovedSubnetDiscoveryHosts(subnet, allowlist, authorizationMode) {
  if (!subnet || subnet.status !== 'active' || subnet.approvalStatus !== 'approved') {
    return { error: 'SUBNET_NOT_APPROVED' };
  }
  return getApprovedDiscoveryHosts(subnet.cidr, allowlist, MAX_DISCOVERY_HOSTS, {
    requireAllowlist: getDiscoveryAuthorizationMode(authorizationMode)
      !== DISCOVERY_AUTHORIZATION_MODES.SUBNET_REGISTRY,
  });
}

function isTargetAllowed(ip, allowlist) {
  if (!isValidIPv4(ip) || !Array.isArray(allowlist)) return false;
  return allowlist.some((entry) => {
    if (entry === ip) return true;
    const network = parseCidr(entry);
    if (!network) return false;

    const targetParts = ip.split('.').map(Number);
    const networkParts = network.network.split('.').map(Number);
    const targetValue = targetParts.reduce((value, part) => (value * 256) + part, 0);
    const networkValue = networkParts.reduce((value, part) => (value * 256) + part, 0);
    const mask = network.mask === 32 ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - network.mask)) >>> 0);
    return (targetValue & mask) === (networkValue & mask);
  });
}

function createCooldownGuard(cooldownMs) {
  const lastStartedAt = new Map();
  let running = false;

  return {
    begin(key, now = Date.now()) {
      if (running) return { allowed: false, reason: 'already_running' };
      const lastStarted = lastStartedAt.get(key);
      if (lastStarted !== undefined && now - lastStarted < cooldownMs) {
        return { allowed: false, reason: 'cooldown' };
      }
      running = true;
      lastStartedAt.set(key, now);
      return { allowed: true };
    },
    end() {
      running = false;
    },
  };
}

function setEmergencyStop(active) {
  emergencyStopActive = Boolean(active);
}

function isEmergencyStopActive() {
  return emergencyStopActive;
}

module.exports = {
  MAX_DISCOVERY_HOSTS,
  DISCOVERY_AUTHORIZATION_MODES,
  parseAllowlist,
  getDiscoveryAuthorizationMode,
  getApprovedDiscoveryHosts,
  getApprovedSubnetDiscoveryHosts,
  isTargetAllowed,
  createCooldownGuard,
  setEmergencyStop,
  isEmergencyStopActive,
};
