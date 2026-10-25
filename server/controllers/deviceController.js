const Device = require('../models/Device');

const getDevices = async (req, res) => {
  try {
    const devices = await Device.find({});
    res.json(devices);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const getDeviceById = async (req, res) => {
  try {
    const device = await Device.findById(req.params.id);
    if (device) {
      res.json(device);
    } else {
      res.status(404).json({ message: 'Device not found' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

const createDevice = async (req, res) => {
  try {
    const { name, ipAddress, type, location, description, monitoringMethod, pollingInterval, snmpCommunity, snmpVersion } = req.body;
    
    const deviceExists = await Device.findOne({ ipAddress });
    if (deviceExists) {
      return res.status(400).json({ message: 'Device with this IP already exists' });
    }

    const device = new Device({
      name, ipAddress, type, location, description, monitoringMethod, pollingInterval, snmpCommunity, snmpVersion
    });

    const createdDevice = await device.save();
    res.status(201).json(createdDevice);
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

const updateDevice = async (req, res) => {
  try {
    const { name, ipAddress, type, location, description, monitoringMethod, monitoringStatus, pollingInterval, snmpCommunity, snmpVersion } = req.body;
    const device = await Device.findById(req.params.id);

    if (device) {
      device.name = name || device.name;
      device.ipAddress = ipAddress || device.ipAddress;
      device.type = type || device.type;
      device.location = location || device.location;
      device.description = description || device.description;
      device.monitoringMethod = monitoringMethod || device.monitoringMethod;
      device.monitoringStatus = monitoringStatus !== undefined ? monitoringStatus : device.monitoringStatus;
      device.pollingInterval = pollingInterval || device.pollingInterval;
      device.snmpCommunity = snmpCommunity || device.snmpCommunity;
      device.snmpVersion = snmpVersion || device.snmpVersion;

      const updatedDevice = await device.save();
      res.json(updatedDevice);
    } else {
      res.status(404).json({ message: 'Device not found' });
    }
  } catch (error) {
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
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

module.exports = { getDevices, getDeviceById, createDevice, updateDevice, deleteDevice };
