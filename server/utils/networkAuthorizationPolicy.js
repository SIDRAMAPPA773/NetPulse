const { MAX_DISCOVERY_HOSTS, getDiscoveryAuthorizationMode } = require('./networkSafety');

const NETWORK_AUTHORIZATION_MODES = Object.freeze({
  LEGACY_ALLOWLISTS: 'legacy_allowlists',
  APPLICATION_MANAGED: 'application_managed',
});

const AUTO_AUTHORIZATION_INTERFACE_TYPES = Object.freeze([
  'wireless',
  'ethernet',
  'hotspot',
  'virtual',
]);

const DEFAULT_NETWORK_AUTHORIZATION_POLICY = Object.freeze({
  mode: NETWORK_AUTHORIZATION_MODES.APPLICATION_MANAGED,
  autoAuthorizeInterfaces: false,
  interfaceTypes: [],
  maxHosts: MAX_DISCOVERY_HOSTS,
  configuredBy: null,
});

function getNetworkAuthorizationPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_NETWORK_AUTHORIZATION_POLICY };
  }

  const mode = Object.values(NETWORK_AUTHORIZATION_MODES).includes(value.mode)
    ? value.mode
    : NETWORK_AUTHORIZATION_MODES.LEGACY_ALLOWLISTS;
  const interfaceTypes = Array.isArray(value.interfaceTypes)
    ? [...new Set(value.interfaceTypes.filter((type) => AUTO_AUTHORIZATION_INTERFACE_TYPES.includes(type)))]
    : [];
  const maxHosts = Number.isInteger(value.maxHosts)
    ? Math.min(MAX_DISCOVERY_HOSTS, Math.max(1, value.maxHosts))
    : MAX_DISCOVERY_HOSTS;

  return {
    mode,
    autoAuthorizeInterfaces: value.autoAuthorizeInterfaces === true
      && mode === NETWORK_AUTHORIZATION_MODES.APPLICATION_MANAGED
      && interfaceTypes.length > 0,
    interfaceTypes,
    maxHosts,
    configuredBy: value.configuredBy || null,
  };
}

function getEffectiveDiscoveryAuthorizationMode(policyValue, legacyMode) {
  const policy = getNetworkAuthorizationPolicy(policyValue);
  if (policy.mode === NETWORK_AUTHORIZATION_MODES.APPLICATION_MANAGED) return 'subnet_registry';
  if (policyValue && typeof policyValue === 'object' && !Array.isArray(policyValue)) return 'dual';
  return getDiscoveryAuthorizationMode(legacyMode);
}

module.exports = {
  NETWORK_AUTHORIZATION_MODES,
  AUTO_AUTHORIZATION_INTERFACE_TYPES,
  DEFAULT_NETWORK_AUTHORIZATION_POLICY,
  getNetworkAuthorizationPolicy,
  getEffectiveDiscoveryAuthorizationMode,
};
