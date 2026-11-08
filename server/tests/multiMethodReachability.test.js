const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateReachability } = require('../utils/multiMethodReachability');

test('evaluateReachability marks UP when ICMP responds', () => {
  const result = evaluateReachability({
    icmp: { reachable: true, rttAvg: 12 },
  });
  assert.equal(result.status, 'UP');
  assert.equal(result.confirmedMethod, 'icmp');
  assert.equal(result.isReachable, true);
});

test('evaluateReachability marks UP when ICMP is blocked but TCP responds', () => {
  const result = evaluateReachability({
    icmp: { reachable: false, packetLoss: 100 },
    tcp: { reachable: true, openPorts: [443] },
  });
  assert.equal(result.status, 'UP');
  assert.equal(result.confirmedMethod, 'tcp');
  assert.equal(result.isReachable, true);
});

test('evaluateReachability marks UP and multi when both ICMP and SNMP respond', () => {
  const result = evaluateReachability({
    icmp: { reachable: true, rttAvg: 5 },
    snmp: { responded: true, supported: true },
  });
  assert.equal(result.status, 'UP');
  assert.equal(result.confirmedMethod, 'multi');
  assert.deepEqual(result.methodsResponding, ['icmp', 'snmp']);
});

test('evaluateReachability marks DOWN when all checked methods fail', () => {
  const result = evaluateReachability({
    icmp: { reachable: false, packetLoss: 100 },
    tcp: { reachable: false, openPorts: [] },
  });
  assert.equal(result.status, 'DOWN');
  assert.equal(result.confirmedMethod, 'none');
  assert.equal(result.isReachable, false);
});

test('evaluateReachability marks UNKNOWN when ICMP execution error occurs without other confirmations', () => {
  const result = evaluateReachability({
    icmp: { reachable: false, error: 'Command failed' },
  });
  assert.equal(result.status, 'UNKNOWN');
});

test('evaluateReachability marks UNKNOWN when probing is blocked', () => {
  const result = evaluateReachability({
    isBlocked: true,
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.isReachable, false);
});

test('evaluateReachability does not mark UP from neighbour cache alone', () => {
  const result = evaluateReachability({
    neighbour: { ipAddress: '192.168.1.100', macAddress: '00:11:22:33:44:55', state: 'Reachable' },
  });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.isReachable, false);
  assert.match(result.reason, /Neighbour cache/);
});
