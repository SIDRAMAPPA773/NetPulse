const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const POWERSHELL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$statistics = Get-NetAdapterStatistics -ErrorAction Stop',
  "$addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }",
  '$rows = foreach ($stat in $statistics) {',
  '  $ips = @($addresses | Where-Object { $_.InterfaceAlias -eq $stat.Name } | ForEach-Object { $_.IPAddress })',
  '  if ($ips.Count -gt 0) {',
  '    [pscustomobject]@{ interfaceName = [string]$stat.Name; ipAddresses = $ips; receivedBytes = [string]$stat.ReceivedBytes; sentBytes = [string]$stat.SentBytes }',
  '  }',
  '}',
  '$json = ConvertTo-Json -InputObject @($rows) -Compress',
  "if ($json) { $json } else { '[]' }",
].join('\n');

async function readWindowsInterfaceCounters() {
  if (process.platform !== 'win32') {
    throw new Error('Local interface counters are supported only on Windows');
  }

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    POWERSHELL_SCRIPT,
  ], {
    timeout: 5000,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });

  let rows;
  try {
    rows = JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`Could not parse Windows interface counters: ${error.message}`);
  }

  const interfaces = Array.isArray(rows) ? rows : [rows];
  return {
    observedAt: Date.now(),
    interfaces: interfaces.map((entry) => ({
      interfaceName: entry.interfaceName,
      ipAddresses: Array.isArray(entry.ipAddresses) ? entry.ipAddresses : [entry.ipAddresses],
      receivedBytes: entry.receivedBytes,
      sentBytes: entry.sentBytes,
    })).filter((entry) => (
      typeof entry.interfaceName === 'string'
      && entry.interfaceName.length > 0
      && entry.ipAddresses.some((ip) => typeof ip === 'string')
    )),
  };
}

function parseByteCounter(value) {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

function calculateInterfaceRates(previous, current) {
  const elapsedSeconds = (current.observedAt - previous.observedAt) / 1000;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return {
      incomingThroughputBps: null,
      outgoingThroughputBps: null,
      elapsedSeconds: null,
      inboundReason: 'Interface counter sample interval must be greater than zero',
      outboundReason: 'Interface counter sample interval must be greater than zero',
    };
  }

  const calculateRate = (previousValue, currentValue, direction) => {
    const previousCounter = parseByteCounter(previousValue);
    const currentCounter = parseByteCounter(currentValue);
    if (previousCounter === null || currentCounter === null) {
      return { value: null, reason: `${direction} interface byte counter is unavailable or invalid` };
    }
    if (currentCounter < previousCounter) {
      return { value: null, reason: `${direction} interface byte counter reset; waiting for the next sample` };
    }

    const rate = (Number(currentCounter - previousCounter) * 8) / elapsedSeconds;
    return Number.isFinite(rate)
      ? { value: rate, reason: null }
      : { value: null, reason: `${direction} interface throughput could not be calculated` };
  };

  const inbound = calculateRate(previous.receivedBytes, current.receivedBytes, 'Inbound');
  const outbound = calculateRate(previous.sentBytes, current.sentBytes, 'Outbound');
  return {
    incomingThroughputBps: inbound.value,
    outgoingThroughputBps: outbound.value,
    elapsedSeconds,
    inboundReason: inbound.reason,
    outboundReason: outbound.reason,
  };
}

module.exports = {
  readWindowsInterfaceCounters,
  calculateInterfaceRates,
};
