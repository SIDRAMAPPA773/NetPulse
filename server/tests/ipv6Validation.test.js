const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidIPv6,
  getIPv6AddressType,
  parseIpv6Cidr,
} = require('../utils/ipv6Validation');

test('isValidIPv6 validates standard, compressed, and scoped IPv6', () => {
  assert.equal(isValidIPv6('2001:db8::1'), true);
  assert.equal(isValidIPv6('fe80::1%eth0'), true);
  assert.equal(isValidIPv6('::1'), true);
  assert.equal(isValidIPv6('192.168.1.1'), false);
  assert.equal(isValidIPv6('not-an-ip'), false);
});

test('getIPv6AddressType classifies link-local, loopback, and global unicast', () => {
  assert.equal(getIPv6AddressType('::1'), 'loopback');
  assert.equal(getIPv6AddressType('fe80::1%12'), 'link-local');
  assert.equal(getIPv6AddressType('2001:db8::1'), 'global-unicast');
});

test('parseIpv6Cidr safely bounds discovery to small subnets and rejects massive scans', () => {
  const bounded = parseIpv6Cidr('2001:db8::/124');
  assert.equal(bounded.isBoundedForDiscovery, true);
  assert.equal(bounded.hostCount, 16);

  const tooLarge = parseIpv6Cidr('2001:db8::/64');
  assert.equal(tooLarge.isBoundedForDiscovery, false);
  assert.equal(tooLarge.hostCount, Infinity);

  assert.equal(parseIpv6Cidr('invalid/128'), null);
});
