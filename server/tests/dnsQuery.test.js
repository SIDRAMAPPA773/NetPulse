const test = require('node:test');
const assert = require('node:assert/strict');
const { probeDnsQuery } = require('../utils/dnsProbe');

test('probeDnsQuery reports invalid resolver input without fabricating a result', async () => {
  const result = await probeDnsQuery('not-an-ip', 'example.com', { timeoutMs: 100 });
  assert.equal(result.status, 'INVALID');
  assert.equal(result.responseTimeMs, null);
});
