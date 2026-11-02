const test = require('node:test');
const assert = require('node:assert/strict');
const {
  lookupVendorByMac,
  detectOperatingSystem,
  classifyDeviceType,
  identifyDevice,
} = require('../utils/deviceIdentification');

test('lookupVendorByMac maps known prefixes accurately and returns null for unknown', () => {
  assert.equal(lookupVendorByMac('00:00:0C:12:34:56'), 'Cisco Systems');
  assert.equal(lookupVendorByMac('00-50-56-C0-00-08'), 'VMware, Inc.');
  assert.equal(lookupVendorByMac('00:0C:42:11:22:33'), 'MikroTik');
  assert.equal(lookupVendorByMac('00:15:6D:44:55:66'), 'Ubiquiti Inc.');
  assert.equal(lookupVendorByMac('DE:AD:BE:EF:00:01'), null);
});

test('detectOperatingSystem parses system descriptions reliably', () => {
  const linuxDescr = 'Linux campus-srv 5.15.0-89-generic #99-Ubuntu SMP Wed Nov 1 12:00:00 UTC 2026 x86_64';
  assert.ok(detectOperatingSystem(linuxDescr).includes('Ubuntu'));

  const ciscoDescr = 'Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(2)E7, RELEASE SOFTWARE (fc3)';
  assert.equal(detectOperatingSystem(ciscoDescr), 'Cisco IOS 15.2(2)E7');

  const winDescr = 'Hardware: Intel64 Family 6 Model 158 - Software: Windows Version 10.0 (Build 19045 Multiprocessor Free)';
  assert.ok(detectOperatingSystem(winDescr).startsWith('Windows'));

  assert.equal(detectOperatingSystem(''), null);
});

test('classifyDeviceType assigns router, switch, server, printer, or other without fabricating', () => {
  assert.equal(classifyDeviceType({ isGateway: true }), 'router');
  assert.equal(classifyDeviceType({ sysDescr: 'Cisco 2960 Catalyst Switch' }), 'switch');
  assert.equal(classifyDeviceType({ openPorts: [9100] }), 'printer');
  assert.equal(classifyDeviceType({ openPorts: [22, 80], sysDescr: 'Linux server' }), 'server');
  assert.equal(classifyDeviceType({ openPorts: [3389] }), 'pc');
  assert.equal(classifyDeviceType({}), 'other');
});

test('identifyDevice combines signals and keeps unknowns explicit', () => {
  const identified = identifyDevice({
    ipAddress: '10.38.27.1',
    macAddress: '00:00:0C:AA:BB:CC',
    isGateway: true,
    sysDescr: 'Cisco IOS Software, 2900 Software Version 15.1',
  });

  assert.equal(identified.ipAddress, '10.38.27.1');
  assert.equal(identified.vendor, 'Cisco Systems');
  assert.equal(identified.deviceType, 'router');
  assert.equal(identified.operatingSystem, 'Cisco IOS 15.1');

  const unknown = identifyDevice({
    ipAddress: '10.38.27.99',
  });
  assert.equal(unknown.vendor, 'Unknown');
  assert.equal(unknown.deviceType, 'other');
  assert.equal(unknown.operatingSystem, 'Unknown');
});
