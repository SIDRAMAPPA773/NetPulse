const cron = require('node-cron');
const ping = require('ping');
const snmp = require('net-snmp');
const Device = require('../models/Device');
const Metric = require('../models/Metric');
const Alert = require('../models/Alert');
const { getIO } = require('./socketService');

const Setting = require('../models/Setting');

let SIMULATION_MODE = true;
let snmpState = {};

// Default Thresholds
let THRESHOLDS = {
  LATENCY_WARNING: 100,
  LATENCY_CRITICAL: 250,
  PACKET_LOSS_WARNING: 5,
  PACKET_LOSS_CRITICAL: 15
};

const updateSettingsCache = async () => {
  try {
    const settings = await Setting.find({});
    settings.forEach(s => {
      if (s.key === 'SIMULATION_MODE') SIMULATION_MODE = s.value;
      if (s.key === 'LATENCY_WARNING') THRESHOLDS.LATENCY_WARNING = parseInt(s.value);
      if (s.key === 'LATENCY_CRITICAL') THRESHOLDS.LATENCY_CRITICAL = parseInt(s.value);
      if (s.key === 'PACKET_LOSS_WARNING') THRESHOLDS.PACKET_LOSS_WARNING = parseInt(s.value);
      if (s.key === 'PACKET_LOSS_CRITICAL') THRESHOLDS.PACKET_LOSS_CRITICAL = parseInt(s.value);
    });
  } catch (err) {
    console.error('Error fetching settings for monitoring:', err);
  }
};

const processDevice = async (device) => {
  let isAlive = false;
  let latency = 0;
  let packetLoss = 0;
  
  let cpuUtilization = null;
  let memoryUtilization = null;
  let snmpData = null;
  let outgoingTraffic = 0;

  if (SIMULATION_MODE) {
    // Simulate data
    isAlive = Math.random() > 0.05; // 95% chance to be up
    latency = isAlive ? Math.floor(Math.random() * 50) + 10 : null; // 10-60ms
    packetLoss = isAlive ? Math.floor(Math.random() * 3) : 100; // 0-2% packet loss if alive
    
    // Simulate occasional spike
    if (Math.random() > 0.95 && isAlive) {
      latency = Math.floor(Math.random() * 200) + 100; // 100-300ms
    }
    
    cpuUtilization = isAlive ? Math.floor(Math.random() * 40) + 10 : null;
    memoryUtilization = isAlive ? Math.floor(Math.random() * 30) + 20 : null;
    incomingTraffic = isAlive ? Math.floor(Math.random() * 100000) : 0;
    outgoingTraffic = isAlive ? Math.floor(Math.random() * 80000) : 0;
  } else {
    try {
      const isWin = process.platform === 'win32';
      const pingConfig = {
        timeout: 2,
        extra: isWin ? ['-n', '2'] : ['-c', '2']
      };
      const res = await ping.promise.probe(device.ipAddress, pingConfig);
      isAlive = Boolean(res.alive);
      
      let parsedTime = null;
      if (isAlive && res.time !== 'unknown' && !isNaN(parseFloat(res.time))) {
        parsedTime = Math.round(parseFloat(res.time));
      }
      latency = parsedTime;

      let parsedLoss = isAlive ? 0 : 100;
      if (res.packetLoss !== undefined && res.packetLoss !== 'unknown' && !isNaN(parseFloat(res.packetLoss))) {
        parsedLoss = parseFloat(res.packetLoss);
      }
      packetLoss = parsedLoss;

      let snmpData = null;
      if (isAlive && device.monitoringMethod === 'snmp' && device.snmpCommunity) {
        const session = snmp.createSession(device.ipAddress, device.snmpCommunity);
        const oids = ["1.3.6.1.2.1.1.3.0", "1.3.6.1.2.1.2.2.1.10.1", "1.3.6.1.2.1.2.2.1.16.1"];
        const result = await new Promise((resolve) => {
          session.get(oids, function (error, varbinds) {
            const out = { sysUpTime: null, inOctets: null, outOctets: null, supported: true };
            if (error) { out.supported = false; out.error = error.message; }
            else {
              for (let i = 0; i < varbinds.length; i++) {
                if (snmp.isVarbindError(varbinds[i])) { out.supported = false; continue; }
                if (varbinds[i].oid === "1.3.6.1.2.1.1.3.0") out.sysUpTime = Number(varbinds[i].value) || 0;
                if (varbinds[i].oid === "1.3.6.1.2.1.2.2.1.10.1") { out.inOctets = Number(varbinds[i].value) || 0; incomingTraffic = out.inOctets; }
                if (varbinds[i].oid === "1.3.6.1.2.1.2.2.1.16.1") { out.outOctets = Number(varbinds[i].value) || 0; outgoingTraffic = out.outOctets; }
              }
            }
            session.close();
            resolve(out);
          });
        });
        snmpData = result;
        if (result.supported && result.inOctets !== null) {
          const prev = snmpState[device._id];
          const now = Date.now();
          if (prev && result.inOctets >= prev.in && result.outOctets >= prev.out) {
            const elapsed = (now - prev.ts) / 1000;
            if (elapsed > 0) {
              snmpData.inDelta = result.inOctets - prev.in;
              snmpData.outDelta = result.outOctets - prev.out;
              snmpData.elapsedSeconds = elapsed;
              snmpData.inBps = snmpData.inDelta / elapsed;
              snmpData.outBps = snmpData.outDelta / elapsed;
            }
          } else if (prev) {
            // counter reset
            snmpData.counterReset = true;
          }
          snmpState[device._id] = { in: result.inOctets, out: result.outOctets, ts: now };
        }
      }
    } catch (err) {
      console.error(`Monitoring failed for ${device.ipAddress}:`, err.message);
      isAlive = false;
      latency = null;
      packetLoss = 100;
    }
  }

  const measurementSource = SIMULATION_MODE ? 'simulated' : 'real';

  try {
    const previousStatus = device.status;
  const currentStatus = isAlive ? ((latency && latency > THRESHOLDS.LATENCY_WARNING) ? 'WARNING' : 'UP') : 'DOWN';

    // Update Device
    device.status = currentStatus;
    device.lastSeen = new Date();
    await device.save();

    let collectionStatus = 'success';
    let errorMessage = null;
    if (!SIMULATION_MODE && snmpData && snmpData.supported === false) collectionStatus = 'unsupported';

    // Save Metric
    const metric = await Metric.create({
      device: device._id,
      latency,
      packetLoss,
      status: currentStatus,
      cpuUtilization,
      memoryUtilization,
      incomingTraffic,
      outgoingTraffic,
      collectionStatus,
      errorMessage,
      measurementSource,
      snmp: snmpData,
    });

    // Check for alerts
    if (previousStatus !== currentStatus) {
      if (currentStatus === 'DOWN') {
        await createAlert(device, 'DEVICE_DOWN', 'CRITICAL', `${device.name} is unreachable`);
      } else if (previousStatus === 'DOWN' && currentStatus === 'UP') {
        await createAlert(device, 'DEVICE_RECOVERED', 'LOW', `${device.name} has recovered`);
      }
    }

    if (isAlive && latency && latency > THRESHOLDS.LATENCY_CRITICAL) {
      await createAlert(device, 'HIGH_LATENCY', 'HIGH', `Latency critical: ${latency}ms`);
    } else if (isAlive && latency && latency > THRESHOLDS.LATENCY_WARNING) {
      await createAlert(device, 'HIGH_LATENCY', 'MEDIUM', `Latency warning: ${latency}ms`);
    }

    // Notify clients
    try {
      const io = getIO();
      io.emit('deviceUpdated', device);
      io.emit('metricAdded', metric);
    } catch (e) {
      // Socket not initialized yet or error
    }
  } catch (saveErr) {
    console.error(`Error saving monitoring data for ${device.name}:`, saveErr.message);
  }
};

const createAlert = async (device, type, severity, message) => {
  const alert = await Alert.create({
    device: device._id,
    type,
    severity,
    message
  });
  try {
    const io = getIO();
    const alertWithDevice = await Alert.findById(alert._id).populate('device', 'name ipAddress type location');
    io.emit('newAlert', alertWithDevice);
  } catch (e) {}
};

let monitoringStarted = false;
let cycleRunning = false;

const startMonitoring = () => {
  if (monitoringStarted) {
    console.log('Monitoring engine already started; skipping duplicate scheduler');
    return;
  }
  monitoringStarted = true;
  console.log('Monitoring engine started');

  cron.schedule('*/10 * * * * *', async () => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      await updateSettingsCache();
      const devices = await Device.find({ monitoringStatus: true });
      const { Semaphore } = require('../utils/safety');
      const sem = new Semaphore(5);
      await Promise.all(devices.map(async (device) => {
        const release = await sem.acquire();
        try { await processDevice(device); } finally { release(); }
      }));
    } catch (err) {
      console.error('Monitoring error:', err);
    } finally {
      cycleRunning = false;
    }
  });
};

module.exports = { startMonitoring };
