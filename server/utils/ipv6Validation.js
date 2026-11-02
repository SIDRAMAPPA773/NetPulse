const net = require('net');

const MAX_IPV6_DISCOVERY_HOSTS = 256;

function isValidIPv6(ip) {
  if (typeof ip !== 'string') return false;
  // Handle link-local scope zones like fe80::1%eth0 or fe80::1%12
  const [baseIp] = ip.split('%');
  return net.isIPv6(baseIp);
}

function getIPv6AddressType(ip) {
  if (!isValidIPv6(ip)) return 'invalid';
  const [baseIp] = ip.split('%');
  const lower = baseIp.toLowerCase();

  if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0000:0001') return 'loopback';
  if (lower.startsWith('fe80:')) return 'link-local';
  if (lower.startsWith('ff')) return 'multicast';
  if (lower.startsWith('fc') || lower.startsWith('fd')) return 'unique-local';
  if (lower.startsWith('2') || lower.startsWith('3')) return 'global-unicast';
  return 'other';
}

function parseIpv6Cidr(cidr) {
  if (typeof cidr !== 'string') return null;
  const [ipPart, prefixStr] = cidr.split('/');
  if (!prefixStr || !isValidIPv6(ipPart)) return null;

  const prefix = Number(prefixStr);
  if (!Number.isInteger(prefix) || prefix < 1 || prefix > 128) return null;

  // For safe active discovery, prefixes below /120 have >256 hosts and MUST NOT be scanned
  const hostCount = prefix >= 120 ? Math.pow(2, 128 - prefix) : Infinity;

  return {
    cidr: `${ipPart.toLowerCase()}/${prefix}`,
    address: ipPart.toLowerCase(),
    prefix,
    hostCount,
    addressType: getIPv6AddressType(ipPart),
    isBoundedForDiscovery: prefix >= 120 && hostCount <= MAX_IPV6_DISCOVERY_HOSTS,
  };
}

module.exports = {
  MAX_IPV6_DISCOVERY_HOSTS,
  isValidIPv6,
  getIPv6AddressType,
  parseIpv6Cidr,
};
