const Setting = require('../models/Setting');
const { setEmergencyStop } = require('../utils/networkSafety');

const PUBLIC_SETTING_KEYS = [
  'SIMULATION_MODE',
  'EMERGENCY_STOP',
  'LATENCY_WARNING',
  'LATENCY_CRITICAL',
  'PACKET_LOSS_WARNING',
  'PACKET_LOSS_CRITICAL',
];

const getSettings = async (req, res) => {
  try {
    const settings = await Setting.find({ key: { $in: PUBLIC_SETTING_KEYS } });
    const settingsMap = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});
    res.json(settingsMap);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const updateSettings = async (req, res) => {
  try {
    const updates = req.body;
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

      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return res.status(400).json({ message: `${key} must be a number` });
      }
      const numericValue = value;
      const max = key.startsWith('PACKET_LOSS_') ? 100 : 60000;
      if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > max) {
        return res.status(400).json({ message: `${key} must be between 0 and ${max}` });
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
      await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
      if (key === 'EMERGENCY_STOP') setEmergencyStop(value);
    }
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getSettings, updateSettings };
