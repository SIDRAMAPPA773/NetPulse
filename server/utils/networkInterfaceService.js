const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { parseCidr, isPrivateIPv4Cidr } = require('./ipValidation');
const { MAX_DISCOVERY_HOSTS } = require('./networkSafety');

const execFileAsync = promisify(execFile);
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isIpv4(value) {
  return IPV4_PATTERN.test(value)
    && value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function ipv4Cidr(address, netmask) {
  if (!isIpv4(address) || !isIpv4(netmask)) return null;
  const mask = netmask.split('.').map(Number)
    .map((part) => part.toString(2).padStart(8, '0')).join('');
  if (!/^1*0*$/.test(mask)) return null;
  const prefix = mask.split('1').length - 1;
  const addressValue = address.split('.').map(Number)
    .reduce((value, part) => (value * 256) + part, 0) >>> 0;
  const maskValue = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const networkValue = (addressValue & maskValue) >>> 0;
  const network = [
    (networkValue >>> 24) & 255,
    (networkValue >>> 16) & 255,
    (networkValue >>> 8) & 255,
    networkValue & 255,
  ].join('.');
  return `${network}/${prefix}`;
}

function canonicalizeIpv4Cidr(cidr) {
  const [address, prefixText, ...extra] = String(cidr || '').split('/');
  const prefix = Number(prefixText);
  if (extra.length || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const maskValue = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
  const netmask = [
    (maskValue >>> 24) & 255,
    (maskValue >>> 16) & 255,
    (maskValue >>> 8) & 255,
    maskValue & 255,
  ].join('.');
  return ipv4Cidr(address, netmask);
}

function inferInterfaceType(name, description = '') {
  const value = `${name} ${description}`.toLowerCase();
  if (/loopback|^lo\d*$/.test(value)) return 'loopback';
  if (/wi-?fi direct|wireless hosted network|mobile hotspot|hosted network|local area connection\*|usb tether|tether|wwan|cellular|mobile broadband|rmnet|wwp\d/.test(value)) return 'hotspot';
  if (/tunnel|vpn|virtual|vethernet/.test(value)) return 'virtual';
  if (/wi-?fi|wireless|wlan|802\.11/.test(value)) return 'wireless';
  if (/ethernet|^eth\d|^en\d|gigabit|network adapter/.test(value)) return 'ethernet';
  return 'unknown';
}

function getDiscoveryInterfaceEligibility(networkInterface) {
  const { type, status, ipv4 = [], discoveryCidr } = networkInterface;
  const interfaceAddresses = ipv4.filter((address) => (
    ipv4Cidr(address.address, address.netmask) === discoveryCidr
    || canonicalizeIpv4Cidr(address.cidr) === discoveryCidr
  ));
  const isLoopback = type === 'loopback'
    || interfaceAddresses.some((address) => address.internal || address.address.startsWith('127.'));
  if (isLoopback) return { eligible: false, state: 'excluded', reason: 'Loopback interfaces are never scanned' };

  const cidr = parseCidr(discoveryCidr);
  if (!cidr || cidr.cidr !== discoveryCidr || !isPrivateIPv4Cidr(discoveryCidr)) {
    return { eligible: false, state: 'excluded', reason: 'Only canonical private IPv4 subnets are eligible' };
  }
  if (cidr.hostCount > MAX_DISCOVERY_HOSTS) {
    return {
      eligible: false,
      state: 'excluded',
      reason: `Subnet exceeds the ${MAX_DISCOVERY_HOSTS}-host discovery limit`,
      hostCount: cidr.hostCount,
    };
  }
  if (status !== 'up') {
    return {
      eligible: false,
      state: 'excluded',
      reason: 'Interface link is not confirmed up',
      hostCount: cidr.hostCount,
    };
  }
  if (type === 'wireless' || type === 'ethernet' || type === 'hotspot') {
    return { eligible: true, state: 'eligible_for_authorization', reason: null, hostCount: cidr.hostCount };
  }
  return {
    eligible: false,
    state: 'review_required',
    reason: 'VPN and other virtual or unidentified interfaces require administrator review',
    hostCount: cidr.hostCount,
  };
}

function getPolicyEligibleInterface(networkInterface, policy) {
  const { type, status, ipv4 = [], discoveryCidr } = networkInterface;
  const interfaceAddresses = ipv4.filter((address) => (
    ipv4Cidr(address.address, address.netmask) === discoveryCidr
    || canonicalizeIpv4Cidr(address.cidr) === discoveryCidr
  ));
  const baseEligibility = getDiscoveryInterfaceEligibility(networkInterface);
  if (baseEligibility.state === 'excluded' || status !== 'up') {
    return { eligible: false, reason: baseEligibility.reason || 'Interface link is not confirmed up' };
  }
  if (!policy?.autoAuthorizeInterfaces || !policy.interfaceTypes?.includes(type)) {
    return { eligible: false, reason: 'Interface type is outside the administrator-configured authorization scope' };
  }
  if (type === 'unknown' || type === 'loopback') {
    return { eligible: false, reason: 'Unsupported and loopback interfaces cannot be auto-authorized' };
  }
  if (interfaceAddresses.some((address) => address.internal || address.address.startsWith('127.'))) {
    return { eligible: false, reason: 'Loopback interfaces are never auto-authorized' };
  }

  const cidr = parseCidr(discoveryCidr);
  if (!cidr || cidr.cidr !== discoveryCidr || !isPrivateIPv4Cidr(discoveryCidr)) {
    return { eligible: false, reason: 'Only canonical RFC1918 private IPv4 networks are eligible' };
  }
  if (cidr.hostCount > policy.maxHosts || cidr.hostCount > MAX_DISCOVERY_HOSTS) {
    return { eligible: false, reason: `Network exceeds the configured ${policy.maxHosts}-host scope` };
  }

  return { eligible: true, reason: null, cidr, hostCount: cidr.hostCount };
}

function parseWindowsInterfaceData(adapterOutput, routeOutput) {
  const adapters = adapterOutput ? JSON.parse(adapterOutput) : [];
  const routes = routeOutput ? JSON.parse(routeOutput) : [];
  const adapterList = Array.isArray(adapters) ? adapters : [adapters];
  const routeList = Array.isArray(routes) ? routes : [routes];
  const states = new Map(adapterList.map((adapter) => [
    adapter.Name,
    {
      status: adapter.Status === 'Up' ? 'up' : 'down',
      description: adapter.InterfaceDescription || '',
    },
  ]));
  const gateways = new Map(routeList.map((route) => [
    route.InterfaceAlias,
    route.NextHop,
  ]));
  return { states, gateways };
}

function parseLinuxInterfaceData(linkOutput, routeOutput) {
  const links = linkOutput ? JSON.parse(linkOutput) : [];
  const routes = routeOutput ? JSON.parse(routeOutput) : [];
  return {
    states: new Map(links.map((link) => [
      link.ifname,
      {
        status: link.operstate === 'UP' ? 'up' : link.operstate.toLowerCase(),
        description: '',
      },
    ])),
    gateways: new Map(routes.map((route) => [route.dev, route.gateway || null])),
  };
}

async function run(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return stdout;
  } catch (error) {
    console.warn(`Network interface query failed (${command}): ${error.message}`);
    return null;
  }
}

async function getPlatformInterfaceData(platform) {
  if (platform === 'win32') {
    const script = [
      '$adapters = @(Get-NetAdapter | Select-Object Name, Status, InterfaceDescription)',
      "$routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1 InterfaceAlias, NextHop)",
      '[pscustomobject]@{ adapters = $adapters; routes = $routes } | ConvertTo-Json -Depth 4 -Compress',
    ].join('; ');
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    if (!output) return { states: new Map(), gateways: new Map() };
    let data;
    try {
      data = JSON.parse(output);
    } catch (error) {
      console.error('Unable to parse Windows network interface data:', error);
      return { states: new Map(), gateways: new Map() };
    }
    const adapters = Array.isArray(data.adapters) ? data.adapters : data.adapters ? [data.adapters] : [];
    const routes = Array.isArray(data.routes) ? data.routes : data.routes ? [data.routes] : [];
    return parseWindowsInterfaceData(JSON.stringify(adapters), JSON.stringify(routes));
  }

  if (platform === 'linux') {
    const [links, routes] = await Promise.all([
      run('ip', ['-j', 'link', 'show']),
      run('ip', ['-4', '-j', 'route', 'show', 'default']),
    ]);
    if (!links && !routes) return { states: new Map(), gateways: new Map() };
    try {
      return parseLinuxInterfaceData(links, routes);
    } catch (error) {
      console.error('Unable to parse Linux network interface data:', error);
      return { states: new Map(), gateways: new Map() };
    }
  }

  return { states: new Map(), gateways: new Map() };
}

async function detectNetworkInterfaces({ platform = process.platform, networkInterfaces = os.networkInterfaces() } = {}) {
  const { states, gateways } = await getPlatformInterfaceData(platform);
  const interfaces = Object.entries(networkInterfaces).flatMap(([name, entries]) => {
    const state = states.get(name) || {};
    const addresses = entries.map((entry) => {
      const family = typeof entry.family === 'string' ? entry.family : (entry.family === 4 ? 'IPv4' : 'IPv6');
      return {
        address: entry.address,
        family,
        netmask: entry.netmask || null,
        cidr: family === 'IPv4' ? (entry.cidr || ipv4Cidr(entry.address, entry.netmask)) : (entry.cidr || null),
        scopeId: entry.scopeid || null,
        internal: Boolean(entry.internal),
      };
    });
    const ipv4 = addresses.filter((address) => address.family === 'IPv4');
    const ipv6 = addresses.filter((address) => address.family === 'IPv6');
    const cidrs = [...new Set(ipv4
      .map((address) => ipv4Cidr(address.address, address.netmask) || canonicalizeIpv4Cidr(address.cidr))
      .filter(Boolean))];
    const discoveredCidrs = cidrs.length ? cidrs : [null];

    return discoveredCidrs.map((cidr) => {
      const networkInterface = {
        name,
        type: inferInterfaceType(name, state.description),
        status: state.status || 'unknown',
        description: state.description || null,
        defaultGateway: gateways.get(name) || null,
        ipv4,
        ipv6,
        discoveryCidr: cidr,
      };
      return {
        ...networkInterface,
        discoveryEligibility: getDiscoveryInterfaceEligibility(networkInterface),
      };
    });
  });

  return interfaces;
}

module.exports = {
  detectNetworkInterfaces,
  ipv4Cidr,
  canonicalizeIpv4Cidr,
  inferInterfaceType,
  getDiscoveryInterfaceEligibility,
  getPolicyEligibleInterface,
  parseLinuxInterfaceData,
  parseWindowsInterfaceData,
};
