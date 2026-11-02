const snmp = require('net-snmp');

const HARDWARE_OIDS = {
  // System
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',

  // CPU - UCD-SNMP
  ucdCpuUser: '1.3.6.1.4.1.2021.11.9.0',
  ucdCpuSystem: '1.3.6.1.4.1.2021.11.10.0',
  ucdCpuIdle: '1.3.6.1.4.1.2021.11.11.0',

  // CPU - Cisco
  ciscoCpu5Min: '1.3.6.1.4.1.9.9.109.1.1.1.1.5.1',
  ciscoCpu5MinTable: '1.3.6.1.4.1.9.9.109.1.1.1.1.5',
  ciscoCpuAvgBusy5: '1.3.6.1.4.1.9.2.1.58.0',

  // CPU - Host Resources (first 4 cores)
  hrProcessorLoad1: '1.3.6.1.2.1.25.3.3.1.2.1',
  hrProcessorLoad2: '1.3.6.1.2.1.25.3.3.1.2.2',
  hrProcessorLoad3: '1.3.6.1.2.1.25.3.3.1.2.3',
  hrProcessorLoad4: '1.3.6.1.2.1.25.3.3.1.2.4',
  hrProcessorLoadTable: '1.3.6.1.2.1.25.3.3.1.2',

  // Memory - UCD-SNMP (in kB)
  ucdMemTotalReal: '1.3.6.1.4.1.2021.4.5.0',
  ucdMemAvailReal: '1.3.6.1.4.1.2021.4.6.0',
  ucdMemTotalFree: '1.3.6.1.4.1.2021.4.11.0',
  ucdMemBuffer: '1.3.6.1.4.1.2021.4.14.0',
  ucdMemCached: '1.3.6.1.4.1.2021.4.15.0',

  // Memory - Host Resources
  hrMemorySize: '1.3.6.1.2.1.25.2.2.0',
  hrStorageAllocationUnits1: '1.3.6.1.2.1.25.2.3.1.4.1',
  hrStorageSize1: '1.3.6.1.2.1.25.2.3.1.5.1',
  hrStorageUsed1: '1.3.6.1.2.1.25.2.3.1.6.1',
  hrStorageTypeTable: '1.3.6.1.2.1.25.2.3.1.2',
  hrStorageAllocationUnitsTable: '1.3.6.1.2.1.25.2.3.1.4',
  hrStorageSizeTable: '1.3.6.1.2.1.25.2.3.1.5',
  hrStorageUsedTable: '1.3.6.1.2.1.25.2.3.1.6',
  hrStorageRam: '1.3.6.1.2.1.25.2.1.2',

  // Memory - Cisco
  ciscoMemUsed: '1.3.6.1.4.1.9.9.48.1.1.1.5.1',
  ciscoMemFree: '1.3.6.1.4.1.9.9.48.1.1.1.6.1',

  // Temperature - Cisco CISCO-ENVMON-MIB
  ciscoEnvMonTemp: '1.3.6.1.4.1.9.9.13.1.3.1.3.1',
  ciscoEnvMonThreshold: '1.3.6.1.4.1.9.9.13.1.3.1.4.1',
  ciscoEnvMonTempTable: '1.3.6.1.4.1.9.9.13.1.3.1.3',
  ciscoEnvMonThresholdTable: '1.3.6.1.4.1.9.9.13.1.3.1.4',
};

function createSnmpSession(device, options = {}) {
  const timeout = Number.isInteger(options.timeout) ? options.timeout : 1500;
  const retries = Number.isInteger(options.retries) ? options.retries : 0;

  if (device.snmpVersion === '3') {
    const levelKey = device.snmpSecurityLevel || 'noAuthNoPriv';
    const level = snmp.SecurityLevel[levelKey];
    if (!device.snmpSecurityName || level === undefined) {
      throw new Error('SNMPv3 security name and a valid security level are required');
    }

    const user = {
      name: device.snmpSecurityName,
      level,
    };

    if (level >= snmp.SecurityLevel.authNoPriv) {
      const authProto = device.snmpAuthProtocol || 'sha';
      if (!snmp.AuthProtocols[authProto] || !device.snmpAuthKey) {
        throw new Error('SNMPv3 authentication protocol and key are required');
      }
      user.authProtocol = snmp.AuthProtocols[authProto];
      user.authKey = device.snmpAuthKey;
    }

    if (level === snmp.SecurityLevel.authPriv) {
      const privProto = device.snmpPrivProtocol || 'aes';
      if (!snmp.PrivProtocols[privProto] || !device.snmpPrivKey) {
        throw new Error('SNMPv3 privacy protocol and key are required');
      }
      user.privProtocol = snmp.PrivProtocols[privProto];
      user.privKey = device.snmpPrivKey;
    }

    return snmp.createV3Session(device.ipAddress, user, {
      timeout,
      retries,
      context: device.snmpContext || '',
    });
  }

  const version = device.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(device.ipAddress, device.snmpCommunity || 'public', {
    version,
    timeout,
    retries,
  });
}

function boundedSubtree(session, oid, maxVarbinds, beforeRequest) {
  return new Promise((resolve) => {
    const varbinds = [];
    Promise.resolve(beforeRequest?.()).then(() => {
      session.subtree(oid, 10, (batch) => {
        for (const varbind of batch) {
          if (varbinds.length >= maxVarbinds) return true;
          varbinds.push(varbind);
        }
        return varbinds.length >= maxVarbinds;
      }, (error) => resolve({ oid, varbinds, error: error || null }));
    }).catch((error) => resolve({ oid, varbinds, error }));
  });
}

async function collectHardwareTables(session, beforeRequest) {
  const tables = await Promise.all([
    boundedSubtree(session, HARDWARE_OIDS.hrProcessorLoadTable, 64, beforeRequest),
    boundedSubtree(session, HARDWARE_OIDS.ciscoCpu5MinTable, 64, beforeRequest),
    boundedSubtree(session, '1.3.6.1.2.1.25.2.3.1', 512, beforeRequest),
    boundedSubtree(session, '1.3.6.1.4.1.9.9.13.1.3.1', 64, beforeRequest),
  ]);
  return {
    varbinds: tables.flatMap((table) => table.varbinds),
    checks: tables,
  };
}

function parseHardwareVarbinds(varbinds) {
  const values = {};
  const tableValues = new Map();
  for (const vb of varbinds) {
    if (!snmp.isVarbindError(vb)) {
      if (typeof vb.value === 'string' || Buffer.isBuffer(vb.value)) {
        values[vb.oid] = vb.value.toString();
      } else if (typeof vb.value === 'number') {
        values[vb.oid] = vb.value;
      } else if (typeof vb.value === 'bigint') {
        values[vb.oid] = Number(vb.value);
      }
      const match = vb.oid.match(/^(.+)\.(\d+)$/);
      if (match) {
        const row = tableValues.get(match[2]) || {};
        row[match[1]] = values[vb.oid];
        tableValues.set(match[2], row);
      }
    }
  }

  // System
  const system = {
    sysDescr: values[HARDWARE_OIDS.sysDescr] ?? null,
    sysUpTime: values[HARDWARE_OIDS.sysUpTime] ?? null,
    sysName: values[HARDWARE_OIDS.sysName] ?? null,
    sysLocation: values[HARDWARE_OIDS.sysLocation] ?? null,
  };

  // CPU
  let cpuUtilization = null;
  let cpuLoad = null;
  const perCore = [];
  let cpuSource = 'none';
  let cpuReason = 'No supported CPU OID responded';

  if (values[HARDWARE_OIDS.ucdCpuIdle] !== undefined) {
    const idle = Number(values[HARDWARE_OIDS.ucdCpuIdle]);
    if (Number.isFinite(idle) && idle >= 0 && idle <= 100) {
      cpuUtilization = Math.round((100 - idle) * 10) / 10;
      cpuSource = 'ucd-snmp';
      cpuReason = null;
    }
  }
  const ciscoCpuValues = Object.entries(values)
    .filter(([oid, value]) => oid.startsWith(`${HARDWARE_OIDS.ciscoCpu5MinTable}.`)
      && Number.isFinite(value) && value >= 0 && value <= 100)
    .map(([, value]) => value);
  if (cpuUtilization === null && ciscoCpuValues.length > 0) {
    cpuUtilization = Math.round((ciscoCpuValues.reduce((sum, value) => sum + value, 0) / ciscoCpuValues.length) * 10) / 10;
    cpuSource = 'cisco-cpm';
    cpuReason = null;
  }
  if (cpuUtilization === null && values[HARDWARE_OIDS.ciscoCpu5Min] !== undefined) {
    const utilization = Number(values[HARDWARE_OIDS.ciscoCpu5Min]);
    if (Number.isFinite(utilization) && utilization >= 0 && utilization <= 100) {
      cpuUtilization = utilization;
      cpuSource = 'cisco-cpm';
      cpuReason = null;
    }
  }
  if (cpuUtilization === null && values[HARDWARE_OIDS.ciscoCpuAvgBusy5] !== undefined) {
    const utilization = Number(values[HARDWARE_OIDS.ciscoCpuAvgBusy5]);
    if (Number.isFinite(utilization) && utilization >= 0 && utilization <= 100) {
      cpuUtilization = utilization;
      cpuSource = 'cisco-old';
      cpuReason = null;
    }
  }

  // Check hrProcessorLoad cores
  for (const [oid, coreVal] of Object.entries(values)) {
    if (oid.startsWith(`${HARDWARE_OIDS.hrProcessorLoadTable}.`) &&
      Number.isFinite(coreVal) && coreVal >= 0 && coreVal <= 100) {
      perCore.push(coreVal);
    }
  }

  if (cpuUtilization === null && perCore.length > 0) {
    cpuUtilization = Math.round((perCore.reduce((a, b) => a + b, 0) / perCore.length) * 10) / 10;
    cpuSource = 'host-resources-processor';
    cpuReason = null;
  }
  if (perCore.length > 0) {
    cpuLoad = perCore[0];
  }

  // Memory
  let totalBytes = null;
  let usedBytes = null;
  let freeBytes = null;
  let memoryUtilization = null;
  let memorySource = 'none';
  let memoryReason = 'No supported memory OID responded';

  if (values[HARDWARE_OIDS.ucdMemTotalReal] !== undefined) {
    const totalKb = Number(values[HARDWARE_OIDS.ucdMemTotalReal]);
    const availKb = Number(values[HARDWARE_OIDS.ucdMemAvailReal] ?? values[HARDWARE_OIDS.ucdMemTotalFree]);
    if (Number.isFinite(totalKb) && totalKb > 0 && Number.isFinite(availKb) && availKb >= 0 && availKb <= totalKb) {
      totalBytes = totalKb * 1024;
      freeBytes = Number.isFinite(availKb) ? availKb * 1024 : null;
      usedBytes = freeBytes !== null ? totalBytes - freeBytes : null;
      memoryUtilization = Math.round((usedBytes / totalBytes) * 1000) / 10;
      memorySource = 'ucd-snmp';
      memoryReason = null;
    }
  } else {
    const ramStorage = [...tableValues.values()].find((row) => (
      row[HARDWARE_OIDS.hrStorageTypeTable] === HARDWARE_OIDS.hrStorageRam
    ));
    if (ramStorage) {
      const units = Number(ramStorage[HARDWARE_OIDS.hrStorageAllocationUnitsTable]);
      const size = Number(ramStorage[HARDWARE_OIDS.hrStorageSizeTable]);
      const used = Number(ramStorage[HARDWARE_OIDS.hrStorageUsedTable]);
      if (units > 0 && size > 0 && used >= 0 && used <= size) {
        totalBytes = size * units;
        usedBytes = used * units;
        freeBytes = totalBytes - usedBytes;
        memoryUtilization = Math.round((usedBytes / totalBytes) * 1000) / 10;
        memorySource = 'host-resources-storage';
        memoryReason = null;
      }
    }
  }
  if (totalBytes === null && values[HARDWARE_OIDS.ciscoMemUsed] !== undefined && values[HARDWARE_OIDS.ciscoMemFree] !== undefined) {
    const used = Number(values[HARDWARE_OIDS.ciscoMemUsed]);
    const free = Number(values[HARDWARE_OIDS.ciscoMemFree]);
    if (used >= 0 && free >= 0 && (used + free) > 0) {
      usedBytes = used;
      freeBytes = free;
      totalBytes = used + free;
      memoryUtilization = Math.round((usedBytes / totalBytes) * 1000) / 10;
      memorySource = 'cisco-memory-pool';
      memoryReason = null;
    }
  }

  // Temperature
  let temperatureCelsius = null;
  let temperatureThresholdCelsius = null;
  let tempSource = 'none';
  let tempReason = 'No supported temperature sensor OID responded';

  const temperatureEntry = [...tableValues.entries()].find(([, row]) => (
    Number.isFinite(Number(row[HARDWARE_OIDS.ciscoEnvMonTempTable]))
  ));
  if (temperatureEntry) {
    const [sensorIndex, row] = temperatureEntry;
    temperatureCelsius = Number(row[HARDWARE_OIDS.ciscoEnvMonTempTable]);
    const thresholdRow = tableValues.get(sensorIndex);
    temperatureThresholdCelsius = Number(thresholdRow?.[HARDWARE_OIDS.ciscoEnvMonThresholdTable] ?? null);
    tempSource = 'cisco-envmon';
    tempReason = null;
  }

  return {
    system,
    cpu: {
      utilization: cpuUtilization,
      load: cpuLoad,
      perCore,
      source: cpuSource,
      reason: cpuReason,
    },
    memory: {
      totalBytes,
      usedBytes,
      freeBytes,
      utilization: memoryUtilization,
      source: memorySource,
      reason: memoryReason,
    },
    temperature: {
      celsius: temperatureCelsius,
      thresholdCelsius: temperatureThresholdCelsius,
      source: tempSource,
      reason: tempReason,
    },
  };
}

module.exports = {
  HARDWARE_OIDS,
  createSnmpSession,
  collectHardwareTables,
  parseHardwareVarbinds,
};
