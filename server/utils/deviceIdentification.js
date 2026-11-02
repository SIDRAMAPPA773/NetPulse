const OUI_DATABASE = new Map([
  // Cisco
  ['00:00:0C', 'Cisco Systems'], ['00:01:42', 'Cisco Systems'], ['00:01:43', 'Cisco Systems'],
  ['00:01:63', 'Cisco Systems'], ['00:01:64', 'Cisco Systems'], ['00:01:96', 'Cisco Systems'],
  ['00:04:4D', 'Cisco Systems'], ['00:05:5E', 'Cisco Systems'], ['00:08:20', 'Cisco Systems'],
  ['00:08:E3', 'Cisco Systems'], ['00:0C:CE', 'Cisco Systems'], ['00:0E:39', 'Cisco Systems'],
  ['00:11:20', 'Cisco Systems'], ['00:14:1B', 'Cisco Systems'], ['00:15:C6', 'Cisco Systems'],
  ['00:17:0F', 'Cisco Systems'], ['00:18:18', 'Cisco Systems'], ['00:19:2F', 'Cisco Systems'],
  ['00:1A:2F', 'Cisco Systems'], ['00:1B:54', 'Cisco Systems'], ['00:1D:71', 'Cisco Systems'],
  ['00:21:1C', 'Cisco Systems'], ['00:22:55', 'Cisco Systems'], ['00:23:04', 'Cisco Systems'],
  ['00:24:97', 'Cisco Systems'], ['00:26:CB', 'Cisco Systems'], ['00:27:0D', 'Cisco Systems'],

  // Dell
  ['00:14:22', 'Dell Inc.'], ['00:16:35', 'Dell Inc.'], ['00:18:8B', 'Dell Inc.'],
  ['00:1A:A0', 'Dell Inc.'], ['00:21:9B', 'Dell Inc.'], ['18:03:73', 'Dell Inc.'],
  ['18:66:DA', 'Dell Inc.'], ['24:B6:FD', 'Dell Inc.'], ['34:17:EB', 'Dell Inc.'],
  ['44:A8:42', 'Dell Inc.'], ['74:86:7A', 'Dell Inc.'], ['90:B1:1C', 'Dell Inc.'],
  ['B8:2A:72', 'Dell Inc.'], ['D4:BE:D9', 'Dell Inc.'], ['E4:F0:04', 'Dell Inc.'],

  // HP / HPE
  ['00:01:E6', 'Hewlett Packard'], ['00:08:02', 'Hewlett Packard'], ['00:0B:CD', 'Hewlett Packard'],
  ['00:11:0A', 'Hewlett Packard'], ['00:17:A4', 'Hewlett Packard'], ['00:1F:29', 'Hewlett Packard'],
  ['00:23:7D', 'Hewlett Packard'], ['00:25:61', 'Hewlett Packard'], ['3C:D9:2B', 'HP Inc.'],
  ['9C:8E:99', 'HP Inc.'], ['C8:CB:B8', 'HP Inc.'],

  // Intel
  ['00:02:B3', 'Intel Corporation'], ['00:03:47', 'Intel Corporation'], ['00:04:23', 'Intel Corporation'],
  ['00:0E:0C', 'Intel Corporation'], ['00:13:02', 'Intel Corporation'], ['00:15:17', 'Intel Corporation'],
  ['00:18:DE', 'Intel Corporation'], ['00:1B:21', 'Intel Corporation'], ['00:21:6A', 'Intel Corporation'],
  ['34:13:E8', 'Intel Corporation'], ['68:05:CA', 'Intel Corporation'], ['80:86:F2', 'Intel Corporation'],

  // VMware
  ['00:05:69', 'VMware, Inc.'], ['00:0C:29', 'VMware, Inc.'], ['00:1C:14', 'VMware, Inc.'],
  ['00:50:56', 'VMware, Inc.'],

  // Ubiquiti
  ['00:15:6D', 'Ubiquiti Inc.'], ['00:27:22', 'Ubiquiti Inc.'], ['24:A4:3C', 'Ubiquiti Inc.'],
  ['68:D7:9A', 'Ubiquiti Inc.'], ['74:83:C2', 'Ubiquiti Inc.'], ['78:8A:20', 'Ubiquiti Inc.'],
  ['80:2A:A8', 'Ubiquiti Inc.'], ['B4:FB:E4', 'Ubiquiti Inc.'], ['DC:9F:DB', 'Ubiquiti Inc.'],
  ['F0:9F:C2', 'Ubiquiti Inc.'],

  // MikroTik
  ['00:0C:42', 'MikroTik'], ['2C:C8:1B', 'MikroTik'], ['48:8F:5A', 'MikroTik'],
  ['64:D1:54', 'MikroTik'], ['74:4D:28', 'MikroTik'], ['B8:69:F4', 'MikroTik'],
  ['CC:2D:E0', 'MikroTik'], ['D4:CA:6D', 'MikroTik'], ['E4:8D:8C', 'MikroTik'],

  // Apple
  ['00:03:93', 'Apple, Inc.'], ['00:05:02', 'Apple, Inc.'], ['00:0A:95', 'Apple, Inc.'],
  ['00:11:24', 'Apple, Inc.'], ['00:14:51', 'Apple, Inc.'], ['00:17:F2', 'Apple, Inc.'],
  ['00:1E:52', 'Apple, Inc.'], ['00:23:12', 'Apple, Inc.'], ['00:25:00', 'Apple, Inc.'],
  ['3C:07:54', 'Apple, Inc.'], ['40:6C:8F', 'Apple, Inc.'], ['70:56:81', 'Apple, Inc.'],
  ['78:4F:43', 'Apple, Inc.'], ['80:49:71', 'Apple, Inc.'], ['AC:DE:48', 'Apple, Inc.'],
  ['DC:A9:04', 'Apple, Inc.'], ['F0:18:98', 'Apple, Inc.'],

  // Raspberry Pi
  ['28:CD:C1', 'Raspberry Pi Foundation'], ['B8:27:EB', 'Raspberry Pi Foundation'],
  ['DC:A6:32', 'Raspberry Pi Trading'], ['E4:5F:01', 'Raspberry Pi Trading'],

  // TP-Link
  ['00:1D:0F', 'TP-Link Corporation'], ['14:CC:20', 'TP-Link Corporation'],
  ['30:B5:C2', 'TP-Link Corporation'], ['50:C7:BF', 'TP-Link Corporation'],
  ['70:4F:57', 'TP-Link Corporation'], ['98:DA:C4', 'TP-Link Corporation'],
  ['D8:0D:17', 'TP-Link Corporation'], ['EC:08:6B', 'TP-Link Corporation'],
]);

function lookupVendorByMac(macAddress) {
  if (typeof macAddress !== 'string') return null;
  const cleaned = macAddress.trim().replace(/[-.]/g, ':').toUpperCase();
  const prefix = cleaned.split(':').slice(0, 3).join(':');
  return OUI_DATABASE.get(prefix) || null;
}

function detectOperatingSystem(sysDescr) {
  if (typeof sysDescr !== 'string' || !sysDescr.trim()) return null;
  const desc = sysDescr.trim();
  const lower = desc.toLowerCase();

  if (lower.includes('cisco ios software') || lower.includes('cisco adaptive security appliance')) {
    const verMatch = desc.match(/Version\s+([^\s,]+)/i);
    return verMatch ? `Cisco IOS ${verMatch[1]}` : 'Cisco IOS';
  }
  if (lower.includes('junos')) {
    const junosMatch = desc.match(/JUNOS\s+([^\s,]+)/i);
    return junosMatch ? `Junos OS ${junosMatch[1]}` : 'Junos OS';
  }
  if (lower.includes('routeros')) {
    const rosMatch = desc.match(/RouterOS\s+([^\s,]+)/i);
    return rosMatch ? `MikroTik RouterOS ${rosMatch[1]}` : 'MikroTik RouterOS';
  }
  if (lower.includes('linux')) {
    const distroMatch = desc.match(/(Ubuntu|Debian|CentOS|Red Hat|Alpine|Arch|Fedora|SuSE)[^\s,]*/i);
    const kernelMatch = desc.match(/Linux\s+([0-9.]+)/i);
    const distro = distroMatch ? distroMatch[0] : 'Linux';
    const kernel = kernelMatch ? ` (kernel ${kernelMatch[1]})` : '';
    return `${distro}${kernel}`;
  }
  if (lower.includes('windows')) {
    const winMatch = desc.match(/Windows\s+(Server\s+\d+|1[01]|8\.1|8|7|[^\s,]+)/i);
    return winMatch ? `Windows ${winMatch[1]}` : 'Windows';
  }
  if (lower.includes('freebsd') || lower.includes('openbsd') || lower.includes('netbsd')) {
    const bsdMatch = desc.match(/(FreeBSD|OpenBSD|NetBSD)\s+([0-9.]+)/i);
    return bsdMatch ? `${bsdMatch[1]} ${bsdMatch[2]}` : 'BSD';
  }
  if (lower.includes('edgeos')) return 'Ubiquiti EdgeOS';
  if (lower.includes('unifi')) return 'Ubiquiti UniFi';

  return null;
}

function classifyDeviceType({
  ipAddress = '',
  sysDescr = null,
  vendor = null,
  openPorts = [],
  isGateway = false,
  hostname = null,
}) {
  const descLower = (sysDescr || '').toLowerCase();
  const hostLower = (hostname || '').toLowerCase();
  const vendorLower = (vendor || '').toLowerCase();

  // 1. Definite Gateway or Router indicator
  if (isGateway || descLower.includes('router') || descLower.includes('cisco ios') || descLower.includes('routeros') || descLower.includes('junos')) {
    return 'router';
  }

  // 2. Switch indicator
  if (descLower.includes('switch') || descLower.includes('catalyst') || descLower.includes('nexus') || descLower.includes('procurve') || hostLower.includes('sw-') || hostLower.includes('switch')) {
    return 'switch';
  }

  // 3. Printer indicator
  if (openPorts.includes(9100) || openPorts.includes(515) || descLower.includes('laserjet') || descLower.includes('printer') || hostLower.includes('prn') || hostLower.includes('printer')) {
    return 'printer';
  }

  // 4. Access Point indicator
  if (descLower.includes('access point') || descLower.includes('unifi ap') || descLower.includes('airmax') || hostLower.includes('wap') || hostLower.includes('ap-')) {
    return 'ap';
  }

  // 5. Server indicator (Web/DB/SSH server ports, Linux/Windows Server OS)
  if (
    openPorts.includes(22) || openPorts.includes(80) || openPorts.includes(443) ||
    openPorts.includes(3306) || openPorts.includes(5432) || openPorts.includes(8080) ||
    descLower.includes('linux') || descLower.includes('server')
  ) {
    // If it only has desktop remote desktop (3389) and windows without server flags, might be a PC
    if (openPorts.includes(3389) && !openPorts.includes(22) && !openPorts.includes(80) && !openPorts.includes(443) && !descLower.includes('server')) {
      return 'pc';
    }
    return 'server';
  }

  // 6. PC / Workstation indicator
  if (openPorts.includes(3389) || openPorts.includes(445) || descLower.includes('windows 10') || descLower.includes('windows 11')) {
    return 'pc';
  }

  // 7. Vendor hints when no ports or SNMP are accessible
  if (vendorLower.includes('cisco') || vendorLower.includes('mikrotik')) {
    return 'switch'; // common default for network appliance
  }
  if (vendorLower.includes('vmware')) {
    return 'server';
  }
  if (vendorLower.includes('raspberry pi')) {
    return 'server';
  }

  return 'other';
}

function identifyDevice({
  ipAddress,
  macAddress = null,
  hostname = null,
  sysDescr = null,
  sysName = null,
  openPorts = [],
  isGateway = false,
  discoverySource = 'icmp',
}) {
  const vendor = lookupVendorByMac(macAddress);
  const operatingSystem = detectOperatingSystem(sysDescr);
  const effectiveHostname = hostname || sysName || null;
  const deviceType = classifyDeviceType({
    ipAddress,
    sysDescr,
    vendor,
    openPorts,
    isGateway,
    hostname: effectiveHostname,
  });

  return {
    ipAddress,
    macAddress: macAddress || null,
    hostname: effectiveHostname,
    vendor: vendor || 'Unknown',
    deviceType,
    operatingSystem: operatingSystem || 'Unknown',
    discoverySource,
    firstDiscovered: new Date(),
    lastSeen: new Date(),
  };
}

module.exports = {
  OUI_DATABASE,
  lookupVendorByMac,
  detectOperatingSystem,
  classifyDeviceType,
  identifyDevice,
};
