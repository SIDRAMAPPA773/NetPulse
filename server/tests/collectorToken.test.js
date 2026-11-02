const test = require('node:test');
const assert = require('node:assert/strict');
const Collector = require('../models/Collector');
const {
  authenticateCollector,
  createCollectorToken,
  hashCollectorToken,
} = require('../utils/collectorToken');

test('collector tokens are random, bearer-safe, and stored as one-way hashes', () => {
  const first = createCollectorToken();
  const second = createCollectorToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(hashCollectorToken(first).length, 64);
  assert.notEqual(hashCollectorToken(first), first);
});

test('collector authentication resolves only active token hashes', async (t) => {
  const originalFindOne = Collector.findOne;
  const token = createCollectorToken();
  let filter;
  const collector = { _id: 'collector-id', status: 'active' };
  t.after(() => { Collector.findOne = originalFindOne; });
  Collector.findOne = async (value) => {
    filter = value;
    return collector;
  };

  let nextCalled = false;
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
  const req = { headers: { authorization: `Bearer ${token}` } };
  await authenticateCollector(req, response, () => { nextCalled = true; });

  assert.deepEqual(filter, { tokenHash: hashCollectorToken(token), status: 'active' });
  assert.equal(req.collector, collector);
  assert.equal(nextCalled, true);
});

test('collector authentication rejects malformed bearer tokens before querying storage', async (t) => {
  const originalFindOne = Collector.findOne;
  let queried = false;
  t.after(() => { Collector.findOne = originalFindOne; });
  Collector.findOne = async () => { queried = true; };

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
  await authenticateCollector({ headers: { authorization: 'Bearer short' } }, response, () => {});

  assert.equal(response.statusCode, 401);
  assert.equal(queried, false);
});
