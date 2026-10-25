const Device = require('../models/Device');
const os = require('os');
const { exec } = require('child_process');
const ping = require('ping');
const util = require('util');
const execPromise = util.promisify(exec);

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

// Auto-discover live devices on the local private network
const discoverLocalDevices = async (req, res) => {
  try {
    let localIp = '127.0.0.1';
    let prefix = '192.168.1';
    
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          const parts = iface.address.split('.');
          if (parts.length === 4) {
            localIp = iface.address;
            prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
            break;
          }
        }
      }
    }

    // Ping sweep first 50 IPs in parallel to warm ARP cache
    const isWin = process.platform === 'win32';
    const pingConfig = { timeout: 1, extra: isWin ? ['-n', '1'] : ['-c', '1'] };
    const probeIps = Array.from({ length: 60 }, (_, i) => `${prefix}.${i + 1}`);
    await Promise.all(probeIps.map(ip => ping.promise.probe(ip, pingConfig)));

    // Parse ARP table
    let stdout = '';
    try {
      const result = await execPromise('arp -a');
      stdout = result.stdout;
    } catch (e) {
      stdout = '';
    }

    const lines = stdout.split('\n');
    const discovered = [];
    const seenIps = new Set();

    // Include local machine
    discovered.push({
      name: `Host Workstation (${localIp})`,
      ipAddress: localIp,
      macAddress: 'Local Adapter',
      type: 'server',
      location: 'Local Computer',
      description: 'Host monitoring workstation',
      monitoringMethod: 'icmp',
      isLocal: true,
      status: 'UP'
    });
    seenIps.add(localIp);

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3 && parts[0].startsWith(prefix)) {
        const ip = parts[0];
        const mac = parts[1];
        
        if (ip.endsWith('.255') || ip.startsWith('224.') || ip.startsWith('239.') || seenIps.has(ip)) {
          continue;
        }

        seenIps.add(ip);

        let name = `Local Node (${ip})`;
        let devType = 'switch';
        let location = 'Local Subnet';

        if (ip === `${prefix}.1`) {
          name = `Default Wi-Fi Gateway (${ip})`;
          devType = 'router';
          location = 'Main Gateway';
        }

        discovered.push({
          name,
          ipAddress: ip,
          macAddress: mac,
          type: devType,
          location,
          description: `Discovered on ${prefix}.x via ARP table`,
          monitoringMethod: 'icmp',
          status: 'UP'
        });
      }
    }

    // Check existing devices in DB
    const existing = await Device.find({ ipAddress: { $in: Array.from(seenIps) } });
    const existingIps = new Set(existing.map(d => d.ipAddress));

    const finalResults = discovered.map(d => ({
      ...d,
      isEnrolled: existingIps.has(d.ipAddress)
    }));

    res.json({
      subnet: `${prefix}.0/24`,
      localIp,
      count: finalResults.length,
      devices: finalResults
    });
  } catch (error) {
    console.error('Discovery error:', error);
    res.status(500).json({ message: 'Error scanning network', error: error.message });
  }
};

// Batch enroll discovered devices
const enrollMultipleDevices = async (req, res) => {
  try {
    const { devices } = req.body;
    if (!Array.isArray(devices) || devices.length === 0) {
      return res.status(400).json({ message: 'No devices provided' });
    }

    const created = [];
    for (const item of devices) {
      const exists = await Device.findOne({ ipAddress: item.ipAddress });
      if (!exists) {
        const newDev = await Device.create({
          name: item.name || `Device ${item.ipAddress}`,
          ipAddress: item.ipAddress,
          type: item.type || 'switch',
          location: item.location || 'Local Subnet',
          description: item.description || 'Auto-discovered hardware node',
          monitoringMethod: item.monitoringMethod || 'icmp',
          status: 'UP'
        });
        created.push(newDev);
      }
    }

    res.json({ message: `Successfully enrolled ${created.length} devices`, devices: created });
  } catch (error) {
    res.status(500).json({ message: 'Error enrolling devices', error: error.message });
  }
};

module.exports = { 
  getDevices, 
  getDeviceById, 
  createDevice, 
  updateDevice, 
  deleteDevice,
  discoverLocalDevices,
  enrollMultipleDevices
};
