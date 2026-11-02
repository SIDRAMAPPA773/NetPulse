const { exec } = require('child_process');

function normalizeMac(mac) {
  if (typeof mac !== 'string') return null;
  const stripped = mac.trim().replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (stripped.length !== 12) return null;
  return stripped.match(/.{1,2}/g).join(':');
}

function parseArpOutput(stdout, osPlatform = process.platform) {
  const neighbours = [];
  if (typeof stdout !== 'string') return neighbours;

  const lines = stdout.split(/\r?\n/);
  let currentInterface = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Windows interface header: Interface: 192.168.1.100 --- 0x14
    const winIfMatch = trimmed.match(/^Interface:\s*([0-9.]+)/i);
    if (winIfMatch) {
      currentInterface = winIfMatch[1];
      continue;
    }

    // Windows ARP line: 10.38.27.1    00-11-22-33-44-55     dynamic
    const winMatch = trimmed.match(/^([0-9.]+)\s+([0-9a-fA-F-]{17})\s+(\w+)/i);
    if (winMatch) {
      const ip = winMatch[1];
      const mac = normalizeMac(winMatch[2]);
      const type = winMatch[3].toLowerCase();
      // Skip broadcast and multicast
      if (mac && !mac.startsWith('FF:FF:FF:FF:FF:FF') && !ip.startsWith('224.') && !ip.startsWith('239.') && !ip.endsWith('.255')) {
        neighbours.push({
          ipAddress: ip,
          macAddress: mac,
          networkInterface: currentInterface,
          state: type === 'dynamic' ? 'Reachable' : 'Static',
          discoveryTimestamp: new Date(),
        });
      }
      continue;
    }

    // Linux ip neigh line: 10.38.27.1 dev eth0 lladdr 00:11:22:33:44:55 REACHABLE
    const linuxMatch = trimmed.match(/^([0-9a-fA-F:.]+)\s+dev\s+([^\s]+)\s+lladdr\s+([0-9a-fA-F:]{17})\s+(\w+)/i);
    if (linuxMatch) {
      const ip = linuxMatch[1];
      const iface = linuxMatch[2];
      const mac = normalizeMac(linuxMatch[3]);
      const state = linuxMatch[4];
      if (mac && state.toUpperCase() !== 'FAILED') {
        neighbours.push({
          ipAddress: ip,
          macAddress: mac,
          networkInterface: iface,
          state,
          discoveryTimestamp: new Date(),
        });
      }
      continue;
    }

    // Standard BSD/Linux arp -an line: ? (192.168.1.1) at 00:11:22:33:44:55 [ether] on eth0
    const bsdMatch = trimmed.match(/\(([0-9.]+)\)\s+at\s+([0-9a-fA-F:]{17})\s+\[\w+\]\s+on\s+([^\s]+)/i);
    if (bsdMatch) {
      const ip = bsdMatch[1];
      const mac = normalizeMac(bsdMatch[2]);
      const iface = bsdMatch[3];
      if (mac && !mac.startsWith('FF:FF:FF:FF:FF:FF')) {
        neighbours.push({
          ipAddress: ip,
          macAddress: mac,
          networkInterface: iface,
          state: 'Reachable',
          discoveryTimestamp: new Date(),
        });
      }
    }
  }

  return neighbours;
}

function getNeighbourTable() {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'arp -a' : 'ip neigh show || arp -an';
    exec(cmd, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve(new Map());
      }
      const list = parseArpOutput(stdout);
      const table = new Map();
      for (const entry of list) {
        table.set(entry.ipAddress, entry);
      }
      resolve(table);
    });
  });
}

module.exports = {
  normalizeMac,
  parseArpOutput,
  getNeighbourTable,
};
