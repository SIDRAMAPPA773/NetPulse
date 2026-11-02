'use strict';

const { spawn } = require('node:child_process');
const https = require('node:https');
const { URL } = require('node:url');
const { version: agentVersion } = require('./package.json');

const MAX_USABLE_ADDRESSES = 256;
const MAX_SCAN_CONCURRENCY = 32;
const MAX_SCAN_RATE = 50;
const MAX_RETRY_ATTEMPTS = 3;
const MAX_REPORT_QUEUE = 3;
const HTTP_TIMEOUT_MS = 10_000;
const PING_TIMEOUT_MS = 2_500;
const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;
const MAX_PING_OUTPUT_BYTES = 64 * 1024;

function configError(message) {
  return new Error(`Collector configuration error: ${message}`);
}

function ipv4ToNumber(address) {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))) {
    throw new Error('invalid IPv4 address');
  }

  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) {
    throw new Error('invalid IPv4 address');
  }
  return octets.reduce((value, octet) => value * 256 + octet, 0);
}

function numberToIpv4(value) {
  return [
    Math.floor(value / 0x1000000) & 255,
    Math.floor(value / 0x10000) & 255,
    Math.floor(value / 0x100) & 255,
    value & 255,
  ].join('.');
}

function parseCidr(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw configError('NETPULSE_SUBNET_CIDR must be a strict IPv4 CIDR.');
  }

  const match = /^((?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3})\/(0|[1-9]\d?)$/.exec(value);
  if (!match) {
    throw configError('NETPULSE_SUBNET_CIDR must be a strict IPv4 CIDR.');
  }

  let address;
  const prefix = Number(match[2]);
  try {
    address = ipv4ToNumber(match[1]);
  } catch {
    throw configError('NETPULSE_SUBNET_CIDR contains an invalid IPv4 address.');
  }
  if (prefix > 32) {
    throw configError('NETPULSE_SUBNET_CIDR prefix must be between 0 and 32.');
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (address & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  const broadcast = network + size - 1;
  if (network !== address) {
    throw configError('NETPULSE_SUBNET_CIDR must use its canonical network address.');
  }

  const privateRanges = [
    [ipv4ToNumber('10.0.0.0'), ipv4ToNumber('10.255.255.255')],
    [ipv4ToNumber('172.16.0.0'), ipv4ToNumber('172.31.255.255')],
    [ipv4ToNumber('192.168.0.0'), ipv4ToNumber('192.168.255.255')],
  ];
  if (!privateRanges.some(([start, end]) => network >= start && broadcast <= end)) {
    throw configError('NETPULSE_SUBNET_CIDR must be wholly within an RFC1918 private IPv4 range.');
  }

  const usableCount = prefix >= 31 ? size : size - 2;
  if (usableCount < 1 || usableCount > MAX_USABLE_ADDRESSES) {
    throw configError(`NETPULSE_SUBNET_CIDR must contain 1 to ${MAX_USABLE_ADDRESSES} usable addresses.`);
  }

  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const targets = [];
  for (let target = first; target <= last; target += 1) {
    targets.push(numberToIpv4(target));
  }

  return {
    canonical: `${numberToIpv4(network)}/${prefix}`,
    network,
    broadcast,
    prefix,
    targets,
  };
}

function parsePositiveInteger(env, name, defaultValue, maximum) {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return defaultValue;
  }
  if (!/^\d+$/.test(raw)) {
    throw configError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw configError(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function loadConfig(env = process.env) {
  const rawBaseUrl = env.NETPULSE_BACKEND_URL;
  const token = env.NETPULSE_TOKEN;
  const rawCidr = env.NETPULSE_SUBNET_CIDR;

  if (!rawBaseUrl) {
    throw configError('NETPULSE_BACKEND_URL is required.');
  }
  if (!token) {
    throw configError('NETPULSE_TOKEN is required.');
  }
  if (!rawCidr) {
    throw configError('NETPULSE_SUBNET_CIDR is required.');
  }
  if (rawBaseUrl.trim() !== rawBaseUrl || /[?#]/.test(rawBaseUrl)) {
    throw configError('NETPULSE_BACKEND_URL must not contain whitespace, a query, or a fragment.');
  }
  if (!/^[A-Za-z0-9\-._~+/]+=*$/.test(token)) {
    throw configError('NETPULSE_TOKEN must be a non-empty bearer token without whitespace or control characters.');
  }

  let parsedBaseUrl;
  try {
    parsedBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw configError('NETPULSE_BACKEND_URL must be a valid HTTPS URL.');
  }
  if (
    parsedBaseUrl.protocol !== 'https:' ||
    !parsedBaseUrl.hostname ||
    parsedBaseUrl.username ||
    parsedBaseUrl.password ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  ) {
    throw configError('NETPULSE_BACKEND_URL must be an HTTPS origin/base URL without credentials, query, or fragment.');
  }

  const basePath = parsedBaseUrl.pathname.replace(/\/+$/, '');
  const baseUrl = `${parsedBaseUrl.origin}${basePath}`;
  const subnet = parseCidr(rawCidr);
  const intervalSeconds = env.NETPULSE_INTERVAL_SECONDS === undefined || env.NETPULSE_INTERVAL_SECONDS === ''
    ? 60
    : parsePositiveInteger(env, 'NETPULSE_INTERVAL_SECONDS', 60, 3600);
  if (intervalSeconds < 15) {
    throw configError('NETPULSE_INTERVAL_SECONDS must be at least 15 seconds.');
  }

  return Object.freeze({
    baseUrl,
    heartbeatUrl: `${baseUrl}/api/collectors/ingest/heartbeat`,
    reportUrl: `${baseUrl}/api/collectors/ingest/report`,
    token,
    subnet,
    intervalMs: intervalSeconds * 1000,
    concurrency: parsePositiveInteger(env, 'NETPULSE_SCAN_CONCURRENCY', 16, MAX_SCAN_CONCURRENCY),
    scanRatePerSecond: parsePositiveInteger(env, 'NETPULSE_SCAN_RATE', 20, MAX_SCAN_RATE),
  });
}

function delay(milliseconds, signal) {
  if (signal && signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', finish);
      }
      resolve();
    }
    if (signal) {
      signal.addEventListener('abort', finish, { once: true });
    }
  });
}

function parsePingLatency(output) {
  const match = /\btime([=<])(\d+(?:\.\d+)?)\s*ms\b/i.exec(output);
  if (!match) {
    return null;
  }

  const parsed = Number(match[2]);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 60_000) {
    return null;
  }
  const latency = match[1] === '<' ? parsed / 2 : parsed;
  return Number.isFinite(latency) && latency >= 0 && latency <= 60_000 ? latency : null;
}

function pingHost(ipAddress, options = {}) {
  const timeoutMs = options.timeoutMs || PING_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('ping', ['-n', '-c', '1', '-W', '1', ipAddress], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL');
        finish(null, { reachable: false, latencyMs: null });
      }
    }, timeoutMs);

    function finish(error, result) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    const collect = (chunk) => {
      if (output.length < MAX_PING_OUTPUT_BYTES) {
        output += chunk.toString('utf8').slice(0, MAX_PING_OUTPUT_BYTES - output.length);
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      const latencyMs = parsePingLatency(output);
      finish(null, {
        reachable: code === 0 && latencyMs !== null,
        latencyMs: code === 0 ? latencyMs : null,
      });
    });
  });
}

function postJson(url, payload, token, options = {}) {
  const timeoutMs = options.timeoutMs || HTTP_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes || MAX_HTTP_RESPONSE_BYTES;
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': body.length,
      },
    }, (response) => {
      let received = 0;
      response.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxResponseBytes) {
          request.destroy(new Error('Backend response exceeded the size limit.'));
        }
      });
      response.on('error', reject);
      response.on('end', () => {
        if (received > maxResponseBytes) {
          reject(new Error('Backend response exceeded the size limit.'));
        } else if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Backend returned HTTP ${response.statusCode}.`));
        } else {
          resolve();
        }
      });
    });

    const timeout = setTimeout(() => {
      request.destroy(new Error('Backend request timed out.'));
    }, timeoutMs);
    request.on('error', reject);
    request.on('close', () => clearTimeout(timeout));
    request.end(body);
  });
}

class SiteCollector {
  constructor(options) {
    if (!options || !options.config) {
      throw new Error('Collector configuration is required.');
    }
    this.config = options.config;
    this.ping = options.ping || pingHost;
    this.http = options.http || postJson;
    this.logger = options.logger || console;
    this.sleep = options.sleep || delay;
    this.now = options.now || (() => new Date());
    this.reportQueue = [];
    this.nextPingAt = 0;
  }

  async acquirePingSlot() {
    const intervalMs = 1000 / this.config.scanRatePerSecond;
    const now = Date.now();
    const waitMs = Math.max(0, this.nextPingAt - now);
    this.nextPingAt = Math.max(now, this.nextPingAt) + intervalMs;
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
  }

  async scan() {
    const targets = this.config.subnet.targets;
    const observations = new Array(targets.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        const ipAddress = targets[index];
        await this.acquirePingSlot();
        let result;
        try {
          result = await this.ping(ipAddress, { timeoutMs: PING_TIMEOUT_MS });
        } catch {
          result = { reachable: false, latencyMs: null };
        }

        const reachable = Boolean(result && result.reachable);
        const latencyMs = reachable && Number.isFinite(result.latencyMs) &&
          result.latencyMs >= 0 && result.latencyMs <= 60_000
          ? result.latencyMs
          : null;
        observations[index] = {
          ipAddress,
          reachable: reachable && latencyMs !== null,
          latencyMs: reachable && latencyMs !== null ? latencyMs : null,
          packetLoss: reachable && latencyMs !== null ? 0 : 100,
          observedAt: this.now().toISOString(),
        };
      }
    };

    const workerCount = Math.min(this.config.concurrency, targets.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return observations;
  }

  async postWithRetry(url, payload) {
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await this.http(url, payload, this.config.token, {
          timeoutMs: HTTP_TIMEOUT_MS,
          maxResponseBytes: MAX_HTTP_RESPONSE_BYTES,
        });
        return true;
      } catch {
        if (attempt + 1 < MAX_RETRY_ATTEMPTS) {
          await this.sleep(Math.min(250 * (2 ** attempt), 2000));
        }
      }
    }
    return false;
  }

  async flushOneReport() {
    if (this.reportQueue.length === 0) {
      return;
    }
    const oldestReport = this.reportQueue[0];
    if (await this.postWithRetry(this.config.reportUrl, oldestReport)) {
      this.reportQueue.shift();
    }
  }

  async runCycle() {
    const observations = await this.scan();
    const activeTargets = observations.reduce(
      (count, observation) => count + (observation.reachable ? 1 : 0),
      0,
    );
    const heartbeat = {
      agentVersion,
      subnetCidr: this.config.subnet.canonical,
      activeTargets,
    };
    if (!(await this.postWithRetry(this.config.heartbeatUrl, heartbeat))) {
      this.logger.warn('Collector heartbeat failed after bounded retries.');
    }

    if (this.reportQueue.length >= MAX_REPORT_QUEUE) {
      this.reportQueue.shift();
      this.logger.warn('Collector report queue full; dropping oldest report.');
    }
    this.reportQueue.push({ observations });
    await this.flushOneReport();
  }

  async run(signal) {
    while (!signal || !signal.aborted) {
      const startedAt = Date.now();
      try {
        await this.runCycle();
      } catch {
        this.logger.warn('Collector cycle failed; it will retry at the next interval.');
      }
      const waitMs = Math.max(0, this.config.intervalMs - (Date.now() - startedAt));
      if (waitMs > 0) {
        await this.sleep(waitMs, signal);
      }
    }
  }
}

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  const collector = new SiteCollector({ config });
  console.info(`NetPulse site collector ${agentVersion} started for ${config.subnet.canonical}.`);
  await collector.run(controller.signal);
  console.info('NetPulse site collector stopped.');
}

if (require.main === module) {
  main().catch(() => {
    console.error('NetPulse site collector stopped after an unexpected error.');
    process.exitCode = 1;
  });
}

module.exports = {
  MAX_REPORT_QUEUE,
  SiteCollector,
  ipv4ToNumber,
  loadConfig,
  numberToIpv4,
  parseCidr,
  parsePingLatency,
  pingHost,
  postJson,
};
