const test = require('node:test');
const assert = require('node:assert/strict');
const snmp = require('net-snmp');
const { createSnmpSession } = require('../utils/snmpHardwareCollectors');
const { encryptCredential } = require('../utils/snmpCredentialCrypto');

test('createSnmpSession constructs a valid SNMPv3 session config', () => {
  const origCreateV3 = snmp.createV3Session;
  let capturedTarget = null;
  let capturedUser = null;
  let capturedOptions = null;

  snmp.createV3Session = (target, user, options) => {
    capturedTarget = target;
    capturedUser = user;
    capturedOptions = options;
    return { close: () => {} };
  };

  try {
    const device = {
      ipAddress: '10.38.27.191',
      snmpVersion: '3',
      snmpSecurityLevel: 'authPriv',
      snmpSecurityName: 'adminUser',
      snmpAuthProtocol: 'sha256',
      snmpAuthKey: 'authSuperPassword123',
      snmpPrivProtocol: 'aes',
      snmpPrivKey: 'privSuperSecretKey456',
    };

    const session = createSnmpSession(device);
    assert.equal(capturedTarget, '10.38.27.191');
    assert.equal(capturedUser.name, 'adminUser');
    assert.equal(capturedUser.level, snmp.SecurityLevel.authPriv);
    assert.equal(capturedUser.authProtocol, snmp.AuthProtocols.sha256);
    assert.equal(capturedUser.authKey, 'authSuperPassword123');
    assert.equal(capturedUser.privProtocol, snmp.PrivProtocols.aes);
    assert.equal(capturedUser.privKey, 'privSuperSecretKey456');
    session.close();
  } finally {
    snmp.createV3Session = origCreateV3;
  }
});

test('createSnmpSession preserves SNMPv2c session creation', () => {
  const origCreate = snmp.createSession;
  let capturedTarget = null;
  let capturedCommunity = null;
  let capturedOptions = null;

  snmp.createSession = (target, community, options) => {
    capturedTarget = target;
    capturedCommunity = community;
    capturedOptions = options;
    return { close: () => {} };
  };

  try {
    const device = {
      ipAddress: '10.38.27.142',
      snmpVersion: '2c',
      snmpCommunity: 'campus-readonly',
    };

    const session = createSnmpSession(device);
    assert.equal(capturedTarget, '10.38.27.142');
    assert.equal(capturedCommunity, 'campus-readonly');
    assert.equal(capturedOptions.version, snmp.Version2c);
    session.close();
  } finally {
    snmp.createSession = origCreate;
  }
});

test('createSnmpSession decrypts stored SNMPv3 keys only for session creation', () => {
  const originalKey = process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;
  const originalCreateV3 = snmp.createV3Session;
  process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
  let capturedUser;

  snmp.createV3Session = (target, user) => {
    capturedUser = user;
    return { close: () => {} };
  };

  try {
    const session = createSnmpSession({
      ipAddress: '10.38.27.191',
      snmpVersion: '3',
      snmpSecurityLevel: 'authPriv',
      snmpSecurityName: 'monitor',
      snmpAuthProtocol: 'sha256',
      snmpAuthKey: encryptCredential('auth-key'),
      snmpPrivProtocol: 'aes',
      snmpPrivKey: encryptCredential('privacy-key'),
    });
    assert.equal(capturedUser.authKey, 'auth-key');
    assert.equal(capturedUser.privKey, 'privacy-key');
    session.close();
  } finally {
    snmp.createV3Session = originalCreateV3;
    if (originalKey === undefined) delete process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  }
});

test('createSnmpSession does not fall back to a public SNMPv3 username or empty security keys', () => {
  assert.throws(() => createSnmpSession({
    ipAddress: '10.38.27.191',
    snmpVersion: '3',
    snmpSecurityLevel: 'noAuthNoPriv',
  }), /security name/);
  assert.throws(() => createSnmpSession({
    ipAddress: '10.38.27.191',
    snmpVersion: '3',
    snmpSecurityName: 'monitor',
    snmpSecurityLevel: 'authPriv',
    snmpAuthKey: 'configured-auth-key',
  }), /privacy protocol and key/);
});
