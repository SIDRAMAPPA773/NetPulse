const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArpOutput, normalizeMac } = require('../utils/neighbourService');

test('normalizeMac formats colon-separated uppercase MAC address', () => {
  assert.equal(normalizeMac('00-11-22-33-44-55'), '00:11:22:33:44:55');
  assert.equal(normalizeMac('00:11:22:33:44:55'), '00:11:22:33:44:55');
  assert.equal(normalizeMac('0011.2233.4455'), '00:11:22:33:44:55');
  assert.equal(normalizeMac('invalid-mac'), null);
});

test('parseArpOutput parses Windows arp -a table output correctly', () => {
  const windowsArp = `
Interface: 10.38.27.142 --- 0x14
  Internet Address      Physical Address      Type
  10.38.27.1            00-11-22-33-44-55     dynamic
  10.38.27.191          00-50-56-c0-00-08     dynamic
  10.38.27.255          ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static
`;
  const result = parseArpOutput(windowsArp, 'win32');
  assert.equal(result.length, 2);
  assert.equal(result[0].ipAddress, '10.38.27.1');
  assert.equal(result[0].macAddress, '00:11:22:33:44:55');
  assert.equal(result[0].networkInterface, '10.38.27.142');
  assert.equal(result[0].state, 'Reachable');

  assert.equal(result[1].ipAddress, '10.38.27.191');
  assert.equal(result[1].macAddress, '00:50:56:C0:00:08');
});

test('parseArpOutput parses Linux ip neigh table output correctly', () => {
  const linuxNeigh = `
10.38.27.1 dev eth0 lladdr 00:11:22:33:44:55 REACHABLE
10.38.27.191 dev eth0 lladdr 00:50:56:c0:00:08 STALE
10.38.27.200 dev eth0  FAILED
`;
  const result = parseArpOutput(linuxNeigh, 'linux');
  assert.equal(result.length, 2);
  assert.equal(result[0].ipAddress, '10.38.27.1');
  assert.equal(result[0].macAddress, '00:11:22:33:44:55');
  assert.equal(result[0].networkInterface, 'eth0');
  assert.equal(result[0].state, 'REACHABLE');
});
