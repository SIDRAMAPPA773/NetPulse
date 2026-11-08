const { exec } = require('child_process');

function parseWindowsNetstatRoutes(stdout) {
  const routes = [];
  const gateways = [];
  if (typeof stdout !== 'string') return { routes, gateways };

  const lines = stdout.split(/\r?\n/);
  let inIpv4Table = false;
  let inIpv6Table = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.includes('IPv4 Route Table')) {
      inIpv4Table = true;
      inIpv6Table = false;
      continue;
    }
    if (trimmed.includes('IPv6 Route Table')) {
      inIpv4Table = false;
      inIpv6Table = true;
      continue;
    }
    if (trimmed.includes('Persistent Routes:')) {
      inIpv4Table = false;
      inIpv6Table = false;
      continue;
    }

    if (inIpv4Table) {
      // e.g.: 0.0.0.0          0.0.0.0     10.238.79.51    10.238.79.191     35
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 5 && /^(\d{1,3}\.){3}\d{1,3}$/.test(parts[0])) {
        const destination = parts[0];
        const netmask = parts[1];
        const gateway = parts[2];
        const interfaceIp = parts[3];
        const metric = Number(parts[4]) || 0;

        const isDefault = destination === '0.0.0.0';
        const route = {
          destination,
          netmask,
          gateway,
          interfaceIp,
          metric,
          isDefault,
          protocol: 'IPv4',
        };
        routes.push(route);

        if (isDefault && gateway !== 'On-link' && /^(\d{1,3}\.){3}\d{1,3}$/.test(gateway)) {
          gateways.push({
            gatewayIp: gateway,
            interfaceIp,
            metric,
            isDefault: true,
            protocol: 'IPv4',
          });
        }
      }
    }

    if (inIpv6Table) {
      // e.g.: 18     51 ::/0                     fe80::ec66:28ff:fe63:37ac
      const match = trimmed.match(/^(\d+)\s+(\d+)\s+([^\s]+)\s+([^\s]+)/);
      if (match) {
        const interfaceIndex = Number(match[1]);
        const metric = Number(match[2]) || 0;
        const destination = match[3];
        const gateway = match[4];
        const isDefault = destination === '::/0';

        const route = {
          interfaceIndex,
          metric,
          destination,
          gateway,
          isDefault,
          protocol: 'IPv6',
        };
        routes.push(route);

        if (isDefault && gateway !== 'On-link') {
          gateways.push({
            gatewayIp: gateway,
            interfaceIndex,
            metric,
            isDefault: true,
            protocol: 'IPv6',
          });
        }
      }
    }
  }

  return { routes, gateways };
}

function parseLinuxIpRoute(stdout) {
  const routes = [];
  const gateways = [];
  if (typeof stdout !== 'string') return { routes, gateways };

  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // default via 192.168.1.1 dev eth0 proto dhcp metric 100
    const defaultMatch = trimmed.match(/^default\s+via\s+([^\s]+)\s+dev\s+([^\s]+)(?:\s+metric\s+(\d+))?/i);
    if (defaultMatch) {
      const gatewayIp = defaultMatch[1];
      const iface = defaultMatch[2];
      const metric = Number(defaultMatch[3]) || 0;
      gateways.push({
        gatewayIp,
        interfaceName: iface,
        metric,
        isDefault: true,
        protocol: gatewayIp.includes(':') ? 'IPv6' : 'IPv4',
      });
      routes.push({
        destination: gatewayIp.includes(':') ? '::/0' : '0.0.0.0/0',
        gateway: gatewayIp,
        interfaceName: iface,
        metric,
        isDefault: true,
        protocol: gatewayIp.includes(':') ? 'IPv6' : 'IPv4',
      });
      continue;
    }

    // 192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.50
    const subnetMatch = trimmed.match(/^([^\s]+)\s+dev\s+([^\s]+)(?:\s+proto\s+[^\s]+)?(?:\s+scope\s+[^\s]+)?(?:\s+src\s+([^\s]+))?/i);
    if (subnetMatch) {
      routes.push({
        destination: subnetMatch[1],
        interfaceName: subnetMatch[2],
        interfaceIp: subnetMatch[3] || null,
        gateway: 'On-link',
        isDefault: false,
        protocol: subnetMatch[1].includes(':') ? 'IPv6' : 'IPv4',
      });
    }
  }

  return { routes, gateways };
}

function getLocalRoutes() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'netstat -rn' : 'ip route show || netstat -rn';

    exec(cmd, { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) {
        return resolve({ routes: [], gateways: [] });
      }

      if (isWin) {
        resolve(parseWindowsNetstatRoutes(stdout));
      } else {
        resolve(parseLinuxIpRoute(stdout));
      }
    });
  });
}

module.exports = {
  parseWindowsNetstatRoutes,
  parseLinuxIpRoute,
  getLocalRoutes,
};
