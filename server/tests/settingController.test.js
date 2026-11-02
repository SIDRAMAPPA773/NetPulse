const test = require('node:test');
const assert = require('node:assert/strict');
const Setting = require('../models/Setting');
const { updateSettings } = require('../controllers/settingController');

test('administrator can explicitly change discovery authorization mode and change is audited', async (t) => {
  const originalFind = Setting.find;
  const originalFindOneAndUpdate = Setting.findOneAndUpdate;
  const originalConsoleInfo = console.info;
  const updates = [];
  const auditEvents = [];
  t.after(() => {
    Setting.find = originalFind;
    Setting.findOneAndUpdate = originalFindOneAndUpdate;
    console.info = originalConsoleInfo;
  });

  Setting.find = async () => [];
  Setting.findOneAndUpdate = async (filter, update) => {
    updates.push({ filter, update });
  };
  console.info = (message) => auditEvents.push(JSON.parse(message));

  let responseBody;
  const response = {
    json(value) {
      responseBody = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  await updateSettings({
    user: { _id: 'admin-id' },
    body: { DISCOVERY_AUTHORIZATION_MODE: 'subnet_registry' },
  }, response);

  assert.equal(response.statusCode, undefined);
  assert.deepEqual(responseBody, { message: 'Settings updated successfully' });
  assert.deepEqual(updates, [{
    filter: { key: 'DISCOVERY_AUTHORIZATION_MODE' },
    update: { value: 'subnet_registry' },
  }]);
  assert.equal(auditEvents[0].event, 'discovery.authorization-mode-updated');
  assert.equal(auditEvents[0].actorId, 'admin-id');
  assert.equal(auditEvents[0].mode, 'subnet_registry');
});

test('invalid discovery authorization modes are rejected without persistence', async (t) => {
  const originalFind = Setting.find;
  const originalFindOneAndUpdate = Setting.findOneAndUpdate;
  let saved = false;
  t.after(() => {
    Setting.find = originalFind;
    Setting.findOneAndUpdate = originalFindOneAndUpdate;
  });
  Setting.find = async () => [];
  Setting.findOneAndUpdate = async () => { saved = true; };

  let responseBody;
  const response = {
    json(value) {
      responseBody = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  await updateSettings({
    user: { _id: 'admin-id' },
    body: { DISCOVERY_AUTHORIZATION_MODE: 'unrestricted' },
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(saved, false);
  assert.match(responseBody.message, /must be dual or subnet_registry/);
});

test('administrator can save an application-managed policy with bounded interface scope and actor audit', async (t) => {
  const originalFind = Setting.find;
  const originalFindOneAndUpdate = Setting.findOneAndUpdate;
  const originalConsoleInfo = console.info;
  const persisted = [];
  const auditEvents = [];
  t.after(() => {
    Setting.find = originalFind;
    Setting.findOneAndUpdate = originalFindOneAndUpdate;
    console.info = originalConsoleInfo;
  });
  Setting.find = async () => [];
  Setting.findOneAndUpdate = async (filter, update) => persisted.push({ filter, update });
  console.info = (message) => auditEvents.push(JSON.parse(message));

  const response = {
    json(value) {
      this.body = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  await updateSettings({
    user: { _id: 'admin-id' },
    body: {
      NETWORK_AUTHORIZATION_POLICY: {
        mode: 'application_managed',
        autoAuthorizeInterfaces: true,
        interfaceTypes: ['wireless', 'hotspot'],
        maxHosts: 128,
      },
    },
  }, response);

  assert.equal(response.statusCode, undefined);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].filter.key, 'NETWORK_AUTHORIZATION_POLICY');
  assert.equal(persisted[0].update.value.mode, 'application_managed');
  assert.deepEqual(persisted[0].update.value.interfaceTypes, ['wireless', 'hotspot']);
  assert.equal(persisted[0].update.value.maxHosts, 128);
  assert.equal(persisted[0].update.value.configuredBy, 'admin-id');
  assert.equal(auditEvents[0].event, 'network.authorization-policy-updated');
  assert.equal(auditEvents[0].actorId, 'admin-id');
});

test('automatic authorization rejects empty scope and host limits above the hard cap', async (t) => {
  const originalFind = Setting.find;
  const originalFindOneAndUpdate = Setting.findOneAndUpdate;
  let saved = false;
  t.after(() => {
    Setting.find = originalFind;
    Setting.findOneAndUpdate = originalFindOneAndUpdate;
  });
  Setting.find = async () => [];
  Setting.findOneAndUpdate = async () => { saved = true; };

  const makeResponse = () => ({
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });
  const emptyScopeResponse = makeResponse();
  await updateSettings({
    user: { _id: 'admin-id' },
    body: {
      NETWORK_AUTHORIZATION_POLICY: {
        mode: 'application_managed',
        autoAuthorizeInterfaces: true,
        interfaceTypes: [],
        maxHosts: 256,
      },
    },
  }, emptyScopeResponse);
  assert.equal(emptyScopeResponse.statusCode, 400);
  assert.equal(saved, false);

  const hostLimitResponse = makeResponse();
  await updateSettings({
    user: { _id: 'admin-id' },
    body: {
      NETWORK_AUTHORIZATION_POLICY: {
        mode: 'application_managed',
        autoAuthorizeInterfaces: true,
        interfaceTypes: ['ethernet'],
        maxHosts: 257,
      },
    },
  }, hostLimitResponse);
  assert.equal(hostLimitResponse.statusCode, 400);
  assert.equal(saved, false);
});

test('health transition settings accept bounded integer poll thresholds only', async (t) => {
  const originalFind = Setting.find;
  const originalFindOneAndUpdate = Setting.findOneAndUpdate;
  let saved = false;
  t.after(() => {
    Setting.find = originalFind;
    Setting.findOneAndUpdate = originalFindOneAndUpdate;
  });
  Setting.find = async () => [];
  Setting.findOneAndUpdate = async () => { saved = true; };

  const makeResponse = () => ({
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  });

  const acceptedResponse = makeResponse();
  await updateSettings({
    user: { _id: 'admin-id' },
    body: {
      DEVICE_DOWN_FAILURE_THRESHOLD: 4,
      DEVICE_UP_RECOVERY_THRESHOLD: 2,
    },
  }, acceptedResponse);
  assert.equal(acceptedResponse.statusCode, undefined);
  assert.equal(saved, true);

  saved = false;
  const rejectedResponse = makeResponse();
  await updateSettings({
    user: { _id: 'admin-id' },
    body: { DEVICE_DOWN_FAILURE_THRESHOLD: 2.5 },
  }, rejectedResponse);
  assert.equal(rejectedResponse.statusCode, 400);
  assert.equal(saved, false);
});
