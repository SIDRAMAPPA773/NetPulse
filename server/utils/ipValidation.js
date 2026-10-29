const net = require('net');

function isValidIPv4(ip) {
  if (typeof ip !== 'string') return false;
  if (!net.isIP(ip)) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function parseCidr(cidr) {
  if (typeof cidr !== 'string') return null;
  const [ip, maskStr] = cidr.split('/');
  if (!maskStr) return null;
  if (!isValidIPv4(ip)) return null;
  const mask = Number(maskStr);
  if (!Number.isInteger(mask) || mask < 1 || mask > 32) return null;

  const ipNum = ipToNumber(ip);
  const maskBits = mask === 32 ? 0xFFFFFFFF : ((0xFFFFFFFF << (32 - mask)) >>> 0);
  const networkNum = (ipNum & maskBits) >>> 0;
  const broadcastNum = (networkNum | (~maskBits >>> 0)) >>> 0;
  const hostCount = mask >= 31 ? (mask === 32 ? 1 : 2) : (broadcastNum - networkNum - 1);
  const firstHost = mask >= 31 ? networkNum : networkNum + 1;
  const lastHost = mask >= 31 ? broadcastNum : broadcastNum - 1;

  return {
    cidr: `${numberToIp(networkNum)}/${mask}`,
    network: numberToIp(networkNum),
    broadcast: numberToIp(broadcastNum),
    mask,
    hostCount,
    firstHost: numberToIp(firstHost),
    lastHost: numberToIp(lastHost),
  };
}

function ipToNumber(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

function numberToIp(num) {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
}

function enumerateHosts(cidr, maxHosts = 1024) {
  const info = parseCidr(cidr);
  if (!info) return null;
  if (info.hostCount > maxHosts) return { error: 'EXCEEDS_MAX', info };
  const hosts = [];
  const start = ipToNumber(info.firstHost);
  const end = ipToNumber(info.lastHost);
  for (let n = start; n <= end; n++) {
    hosts.push(numberToIp(n));
  }
  return { info, hosts };
}

module.exports = { isValidIPv4, parseCidr, enumerateHosts, ipToNumber, numberToIp };
