const test = require('node:test');
const assert = require('node:assert/strict');
const { identifyDevice, lookupVendorByMac, detectOperatingSystem, classifyDeviceType } = require('../utils/deviceIdentification');
const { evaluateReachability } = require('../utils/multiMethodReachability');
const { calculateOverallHealthScore } = require('../utils/healthScoreEngine');

test('device identification correctly maps MAC to vendor and sysDescr to OS', () => {
  const result = identifyDevice({
    ipAddress: '10.38.27.142',
    macAddress: '00:14:22:11:22:33',
    sysDescr: 'Linux campus-node 5.15.0-89-generic #99-Ubuntu SMP x86_64',
    openPorts: [22, 80],
  });

  assert.equal(result.vendor, 'Dell Inc.');
  assert.equal(result.deviceType, 'server');
  assert.ok(result.operatingSystem.includes('Ubuntu'));
  assert.equal(result.discoverySource, 'icmp');
});

test('multiMethodReachability confirms reachability via TCP when ICMP fails', () => {
  const result = evaluateReachability({
    icmp: { reachable: false, packetLoss: 100 },
    tcp: { reachable: true, openPorts: [443, 80] },
    neighbour: null,
  });

  assert.equal(result.status, 'UP');
  assert.equal(result.confirmedMethod, 'tcp');
  assert.equal(result.isReachable, true);
  assert.ok(result.reason.includes('tcp'));
});

test('calculateOverallHealthScore assigns Warning and Critical based on performance and hardware', () => {
  const warningScore = calculateOverallHealthScore({
    deviceStatus: 'UP',
    availabilityPercent: 100,
    latency: 180, // high latency
    packetLoss: 8, // high loss
    jitter: 5,
    cpuUtilization: 88, // elevated CPU
    memoryUtilization: 89, // elevated memory
  });

  assert.ok(warningScore.overallScore < 80);
  assert.ok(warningScore.healthStatus === 'Warning' || warningScore.healthStatus === 'Critical');

  const criticalScore = calculateOverallHealthScore({
    deviceStatus: 'UP',
    availabilityPercent: 50,
    latency: 350,
    packetLoss: 40,
    cpuUtilization: 98,
    memoryUtilization: 99,
  });

  assert.ok(criticalScore.overallScore < 60);
  assert.equal(criticalScore.healthStatus, 'Critical');
});
