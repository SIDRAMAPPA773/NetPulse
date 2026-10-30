# NetPulse

NetPulse is a college-network monitoring and performance-analysis application. The existing React/Express/MongoDB application is retained; monitoring stays in the backend and the browser consumes authenticated APIs and Socket.IO events.

## Current behavior and limitations

- The monitoring engine defaults to **simulation mode**. Simulated values are tagged `measurementSource: "simulated"` and are not campus observations.
- Real polling is ICMP-only unless an enrolled device is configured for SNMP. An empty `MONITORING_TARGET_ALLOWLIST` prevents real active probes; the engine does not infer a local subnet or silently switch modes.
- Real ICMP observations include reachability, RTT average/minimum/maximum/deviation, mean absolute consecutive-sample RTT difference (jitter), packet loss, and per-probe-window success percentage.
- Optional SNMP v1/v2c reads `sysUpTime` and IF-MIB counters only for an explicitly configured interface index. Throughput is calculated from valid counter deltas and elapsed time. Counter resets, interface changes, and the first sample produce unavailable rates rather than fabricated values. Configure SNMPv3 credentials, vendor CPU/memory OIDs, and authorized agents before relying on those metrics; those integrations are not implemented.
- On Windows, when an enrolled device IP is assigned to an interface on the monitoring host, NetPulse can also measure that local interface's received (RX) and sent (TX) byte-counter deltas. This is host-interface traffic, not traffic for a remote gateway. Remote interface throughput requires a configured SNMP community and interface index on a supported device.
- Service/TCP, DNS, route tracing, discovery-performance, and engine resource/traffic metrics currently have documented definitions but no collector. CPU and memory values are unavailable unless a supported OID or authorized agent is added.
- The Network Health Index is a heuristic: `100 - 10 * offline device count - 2 * average packet loss - 15 if average latency > 80 ms`, clamped to 0–100. It requires valid latency and loss samples, excludes unknown devices, is not normalized by fleet size, and is **not an SLA**.
- The Reports page exports authenticated inventory, bounded stored telemetry, and recent incidents as CSV or JSON snapshots for 24 hours, 7 days, or 30 days. It does not create archived reports or certify SLAs. CSV fields are quoted and spreadsheet-formula-leading text is neutralized.
- Prometheus/Grafana and the reproducible research experiment workflow are deferred. The current metric registry and bounded observations provide a foundation, not completed experimental results or a novelty claim.
- The scheduler and discovery guard are process-local. Run one backend process only; multiple replicas would need a distributed lease and shared rate limiter before production use.

## Metrics

The backend registry contains 35 definitions with source, formula, unit, timestamp, collection method, applicability, and limitations. Fetch all definitions or filter by category:

```text
GET /api/metrics/registry
GET /api/metrics/registry?category=connectivity
```

Both endpoints require authentication. Definitions are maintained in `server/config/metricsRegistry.js`. A metric's presence in the registry does not imply that a collector currently supports it; unsupported values remain `null` and include an unavailability reason where available.

## Safe configuration

1. Copy `server/.env.example` to `server/.env` without overwriting an existing file.
2. Set `MONGO_URI` and a private `JWT_SECRET` of at least 32 characters. Do not commit `.env`.
3. Keep `MONITORING_TARGET_ALLOWLIST` empty until the network administrator explicitly approves targets. Configure approved IPv4 addresses/CIDRs as comma-separated entries only when authorized.
4. Discovery has a separate `DISCOVERY_ALLOWLIST`. Discovery is admin-only, requires the exact canonical CIDR, is disabled in simulation mode, is limited to 256 hosts, uses bounded concurrency/rate, and has a 60-second cooldown. It never scans an inferred subnet or reads the host ARP table.
5. `MONITORING_MAX_CONCURRENCY` and `MONITORING_MAX_PROBES_PER_SECOND` are clamped to 1–10. Discovery settings are clamped to concurrency 1–4 and 1–4 probe starts per second. Per-device polling intervals are bounded to 10–3600 seconds.
6. The administrator-only Emergency Stop setting prevents new monitoring and discovery probes. An already-running OS ping cannot be forcibly interrupted by the current ping library; cancellation stops subsequent probes and each active probe is timeout-bounded.
7. Simulation mode is on by default. Turning it off does not authorize any target; only the configured target allowlist does.

The example `.env.example` contains placeholders, not production credentials. Device SNMP community strings remain server-side and are removed from device API/socket responses. SNMPv3 is not yet configured. Use an appropriately protected MongoDB deployment and TLS for production.

## Initial setup

Requirements: Node.js 18+, MongoDB, and (for real ICMP) the platform ping executable.

In PowerShell:

```powershell
Copy-Item server\.env.example server\.env
# Edit server\.env: set MONGO_URI and a private JWT_SECRET (32+ characters).
# Set ADMIN_INITIAL_PASSWORD in the environment for initial admin creation.
Set-Location server
npm install
node seed.js
npm test
npm start
```

`seed.js` is idempotent and uses insert-only defaults. It does not delete users, devices, metrics, alerts, or existing settings. It creates `admin@college.edu` only when absent and requires `ADMIN_INITIAL_PASSWORD`; no default password is shipped. Example device entries are demo inventory and do not authorize or initiate real probes.

In another PowerShell window:

```powershell
Set-Location client
npm install
npm run dev
```

The frontend defaults to `http://localhost:5000` and Vite to `http://localhost:5173`. `CLIENT_ORIGIN` is a comma-separated allowlist of exact frontend origins (for example, `http://localhost:5173,http://127.0.0.1:5173`) used consistently by Express and Socket.IO. In development, those two local origins are the defaults when `CLIENT_ORIGIN` is unset; other environments allow only explicitly configured origins.

## API history limits

- `GET /api/devices/:id/metrics?range=1h|6h|24h|7d` uses the indexed device/timestamp query and returns at most 1,000 newest samples.
- `GET /api/analytics/performance?range=1h|6h|24h|7d|30d` returns at most 500 samples.
- `GET /api/alerts?device=<id>` returns at most 100 most recently updated incidents for that device.
- Device inventory returns at most 500 devices with recent metric summaries and active-alert counts.

All these routes require authentication. Device enrollment, edits, deletion, discovery, and settings updates require administrator authorization. Public registration creates viewer accounts only.

## Verification

Run backend tests with `Set-Location server; npm test`, frontend tests with `Set-Location client; npm test`, frontend lint with `Set-Location client; npm run lint`, and production build with `Set-Location client; npm run build`. Tests use mocked probes; they do not scan networks.
