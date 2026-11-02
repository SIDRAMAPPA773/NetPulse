const Setting = require('../models/Setting');
const { MAX_DISCOVERY_HOSTS, setEmergencyStop } = require('../utils/networkSafety');
const {
  AUTO_AUTHORIZATION_INTERFACE_TYPES,
  NETWORK_AUTHORIZATION_MODES,
  DEFAULT_NETWORK_AUTHORIZATION_POLICY,
  getNetworkAuthorizationPolicy,
} = require('../utils/networkAuthorizationPolicy');

const PUBLIC_SETTING_KEYS = [
  'SIMULATION_MODE',
  'EMERGENCY_STOP',
  'DISCOVERY_AUTHORIZATION_MODE',
  'NETWORK_AUTHORIZATION_POLICY',
  'LATENCY_WARNING',
  'LATENCY_CRITICAL',
  'PACKET_LOSS_WARNING',
  'PACKET_LOSS_CRITICAL',
  'DEVICE_DOWN_FAILURE_THRESHOLD',
  'DEVICE_UP_RECOVERY_THRESHOLD',
];

const getSettings = async (req, res) => {
  try {
    const settings = await Setting.find({ key: { $in: PUBLIC_SETTING_KEYS } });
    const settingsMap = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.key === 'NETWORK_AUTHORIZATION_POLICY'
        ? (() => {
          const { configuredBy, ...publicPolicy } = getNetworkAuthorizationPolicy(setting.value);
          return publicPolicy;
        })()
        : setting.value;
      return acc;
    }, {});
    res.json(settingsMap);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateSettings = async (req, res) => {
  try {
    const updates = { ...req.body };
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ message: 'Settings must be provided as an object' });
    }

    const entries = Object.entries(updates);
    if (entries.length === 0 || entries.some(([key]) => !PUBLIC_SETTING_KEYS.includes(key))) {
      return res.status(400).json({ message: 'One or more settings are not configurable through this endpoint' });
    }

    for (const [key, value] of entries) {
      if (key === 'SIMULATION_MODE' || key === 'EMERGENCY_STOP') {
        if (typeof value !== 'boolean') {
          return res.status(400).json({ message: `${key} must be a boolean` });
        }
        continue;
      }

      if (key === 'DISCOVERY_AUTHORIZATION_MODE') {
        if (!['dual', 'subnet_registry'].includes(value)) {
          return res.status(400).json({ message: 'DISCOVERY_AUTHORIZATION_MODE must be dual or subnet_registry' });
        }
        continue;
      }

      if (key === 'NETWORK_AUTHORIZATION_POLICY') {
        const policy = value;
        if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
          return res.status(400).json({ message: 'NETWORK_AUTHORIZATION_POLICY must be an object' });
        }
        const allowedKeys = ['mode', 'autoAuthorizeInterfaces', 'interfaceTypes', 'maxHosts'];
        if (Object.keys(policy).some((field) => !allowedKeys.includes(field))) {
          return res.status(400).json({ message: 'Network authorization policy contains unsupported fields' });
        }
        if (!Object.values(NETWORK_AUTHORIZATION_MODES).includes(policy.mode)) {
          return res.status(400).json({ message: 'Network authorization mode must be legacy_allowlists or application_managed' });
        }
        if (typeof policy.autoAuthorizeInterfaces !== 'boolean') {
          return res.status(400).json({ message: 'autoAuthorizeInterfaces must be a boolean' });
        }
        if (!Array.isArray(policy.interfaceTypes)
          || policy.interfaceTypes.some((type) => !AUTO_AUTHORIZATION_INTERFACE_TYPES.includes(type))) {
          return res.status(400).json({ message: 'interfaceTypes contains an unsupported network interface type' });
        }
        if (new Set(policy.interfaceTypes).size !== policy.interfaceTypes.length) {
          return res.status(400).json({ message: 'interfaceTypes must not contain duplicates' });
        }
        if (!Number.isInteger(policy.maxHosts) || policy.maxHosts < 1 || policy.maxHosts > MAX_DISCOVERY_HOSTS) {
          return res.status(400).json({ message: `maxHosts must be between 1 and ${MAX_DISCOVERY_HOSTS}` });
        }
        if (policy.autoAuthorizeInterfaces
          && (policy.mode !== NETWORK_AUTHORIZATION_MODES.APPLICATION_MANAGED || policy.interfaceTypes.length === 0)) {
          return res.status(400).json({
            message: 'Automatic interface authorization requires application-managed mode and an explicit interface type scope',
          });
        }
        updates[key] = {
          ...DEFAULT_NETWORK_AUTHORIZATION_POLICY,
          ...policy,
          interfaceTypes: [...new Set(policy.interfaceTypes)],
          configuredBy: req.user._id,
        };
        continue;
      }

      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return res.status(400).json({ message: `${key} must be a number` });
      }
      const numericValue = value;
      const isStateThreshold = key.startsWith('DEVICE_');
      const min = isStateThreshold ? 1 : 0;
      const max = isStateThreshold ? 10 : key.startsWith('PACKET_LOSS_') ? 100 : 60000;
      if (numericValue < min || numericValue > max || (isStateThreshold && !Number.isInteger(numericValue))) {
        const expected = isStateThreshold ? 'an integer ' : '';
        return res.status(400).json({ message: `${key} must be ${expected}between ${min} and ${max}` });
      }
    }

    const warningLatency = updates.LATENCY_WARNING;
    const criticalLatency = updates.LATENCY_CRITICAL;
    if (warningLatency !== undefined && criticalLatency !== undefined && Number(warningLatency) >= Number(criticalLatency)) {
      return res.status(400).json({ message: 'Latency warning must be lower than the critical threshold' });
    }
    const warningLoss = updates.PACKET_LOSS_WARNING;
    const criticalLoss = updates.PACKET_LOSS_CRITICAL;
    if (warningLoss !== undefined && criticalLoss !== undefined && Number(warningLoss) >= Number(criticalLoss)) {
      return res.status(400).json({ message: 'Packet-loss warning must be lower than the critical threshold' });
    }

    const storedSettings = await Setting.find({ key: { $in: PUBLIC_SETTING_KEYS } });
    const currentValues = Object.fromEntries(storedSettings.map((setting) => [setting.key, setting.value]));
    const nextLatencyWarning = Number(updates.LATENCY_WARNING ?? currentValues.LATENCY_WARNING ?? 100);
    const nextLatencyCritical = Number(updates.LATENCY_CRITICAL ?? currentValues.LATENCY_CRITICAL ?? 250);
    const nextLossWarning = Number(updates.PACKET_LOSS_WARNING ?? currentValues.PACKET_LOSS_WARNING ?? 5);
    const nextLossCritical = Number(updates.PACKET_LOSS_CRITICAL ?? currentValues.PACKET_LOSS_CRITICAL ?? 15);
    if (nextLatencyWarning >= nextLatencyCritical || nextLossWarning >= nextLossCritical) {
      return res.status(400).json({ message: 'Warning thresholds must remain lower than their critical thresholds' });
    }

    for (const [key, value] of entries) {
      const persistedValue = key === 'NETWORK_AUTHORIZATION_POLICY' ? updates[key] : value;
      await Setting.findOneAndUpdate({ key }, { value: persistedValue }, { upsert: true });
      if (key === 'EMERGENCY_STOP') setEmergencyStop(value);
      if (key === 'DISCOVERY_AUTHORIZATION_MODE') {
        console.info(JSON.stringify({
          event: 'discovery.authorization-mode-updated',
          actorId: String(req.user._id),
          mode: value,
          at: new Date().toISOString(),
        }));
      }
      if (key === 'NETWORK_AUTHORIZATION_POLICY') {
        console.info(JSON.stringify({
          event: 'network.authorization-policy-updated',
          actorId: String(req.user._id),
          mode: value.mode,
          autoAuthorizeInterfaces: value.autoAuthorizeInterfaces,
          interfaceTypes: value.interfaceTypes,
          maxHosts: value.maxHosts,
          at: new Date().toISOString(),
        }));
      }
    }
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getSettings, updateSettings };
