const test = require('node:test');
const assert = require('node:assert/strict');
const Device = require('../models/Device');
const { createDevice } = require('../controllers/deviceController');

const originalKey = process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;

test.after(() => {
  if (originalKey === undefined) delete process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

test('device creation encrypts SNMP secrets before persistence and omits them from the response', async (t) => {
  const originalFindOne = Device.findOne;
  const originalSave = Device.prototype.save;
  const savedDevices = [];
  process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');
  t.after(() => {
    Device.findOne = originalFindOne;
    Device.prototype.save = originalSave;
  });
  Device.findOne = async () => null;
  Device.prototype.save = async function save() {
    savedDevices.push(this);
    return this;
  };

  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await createDevice({
    body: {
      name: 'SNMP device',
      ipAddress: '192.168.10.5',
      type: 'switch',
      snmpCommunity: 'private-community',
      snmpAuthKey: 'private-auth',
      snmpPrivKey: 'private-privacy',
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(savedDevices.length, 1);
  assert.match(savedDevices[0].snmpCommunity, /^enc:v1:/);
  assert.match(savedDevices[0].snmpAuthKey, /^enc:v1:/);
  assert.match(savedDevices[0].snmpPrivKey, /^enc:v1:/);
  assert.equal(response.body.snmpCommunity, undefined);
  assert.equal(response.body.snmpAuthKey, undefined);
  assert.equal(response.body.snmpPrivKey, undefined);
});

test('device creation refuses SNMP secrets when the encryption key is missing', async (t) => {
  const originalFindOne = Device.findOne;
  const originalSave = Device.prototype.save;
  let saved = false;
  delete process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;
  t.after(() => {
    Device.findOne = originalFindOne;
    Device.prototype.save = originalSave;
    if (originalKey === undefined) delete process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.SNMP_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });
  Device.findOne = async () => null;
  Device.prototype.save = async function save() {
    saved = true;
    return this;
  };

  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await createDevice({
    body: {
      name: 'SNMP device',
      ipAddress: '192.168.10.6',
      type: 'switch',
      snmpCommunity: 'must-not-be-plaintext',
    },
  }, response);

  assert.equal(response.statusCode, 503);
  assert.equal(saved, false);
  assert.match(response.body.message, /SNMP_CREDENTIAL_ENCRYPTION_KEY/);
});
