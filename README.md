# NetPulse

NetPulse is a college-network monitoring and performance-analysis application. The existing React/Express/MongoDB application is retained; monitoring stays in the backend and the browser consumes authenticated APIs and Socket.IO events.

## Current behavior and limitations

- The monitoring engine defaults to **simulation mode**. Simulated values are tagged `measurementSource: "simulated"` and are not campus observations.
- Real polling uses ICMP for reachability and performance. A device is eligible only when its enrollment is approved and monitoring is enabled, its IP is inside an active approved subnet with subnet monitoring enabled, and the selected network authorization policy permits it. Legacy mode also requires `MONITORING_TARGET_ALLOWLIST`; application-managed mode replaces that per-IP/CIDR check with the approved subnet registry.
- Real ICMP observations include reachability, RTT average/minimum/maximum/deviation, mean absolute consecutive-sample RTT difference (jitter), packet loss, and per-probe-window success percentage.
- Device availability uses consecutive completed observations: by default three failed cycles mark a device down and two successful cycles confirm recovery. Collection/configuration errors do not count as reachability failures. Administrators can adjust both thresholds from Engine Settings (1–10); performance degradation remains a separate warning state.
- The topology map displays enrolled devices but does not draw inferred links. Verified adjacency data (for example, observed LLDP/CDP neighbor records) is required before edges are presented.
- SNMP v1/v2c/v3 collection uses bounded requests only for devices authorized by the selected network policy. It reads `sysUpTime`, IF-MIB counters, and supported hardware sources: UCD-SNMP CPU/memory scalars, the Host Resources processor/storage tables, Cisco CPU MIB values, and discovered Cisco environmental sensor rows. Unsupported OIDs remain null and include a reason. SNMPv3 credentials are server-side and never included in device/diagnostic responses or logs. SNMPv1 agents that reject a multi-OID request can limit the available diagnostic detail.
- IF-MIB collection uses 64-bit high-capacity counters when available and 32-bit fallback, plus interface status, `ifSpeed`/`ifHighSpeed`, errors, and discards. Rates use consecutive samples and measured elapsed time; resets, interface changes, first samples, and missing counters produce null rates. Utilization is only calculated from a reported non-zero interface speed.
- Temperature collection only reports a value when the bounded Cisco environmental table walk returns a sensor. Other vendor environmental MIBs are not yet implemented; no sensor response is reported as unsupported rather than as zero.
- On Windows, when an enrolled device IP is assigned to an interface on the monitoring host, NetPulse can also measure that local interface's received (RX) and sent (TX) byte-counter deltas. This is host-interface traffic, not traffic for a remote gateway. Remote interface throughput requires a configured SNMP community and interface index on a supported device.
- An outbound Node.js site collector and scoped backend API are implemented. Each collector is bound to one explicitly approved private subnet, uses a revocable bearer token over HTTPS, and can only report addresses in that scope. Deployment still requires a trusted HTTPS backend endpoint reachable from the site; Prepare.sh persistence and real-device integration have not been verified. Do not expose unauthenticated Windows Exporter or `node_exporter` endpoints.
- Service/TCP, DNS, route tracing, discovery-performance, and engine resource/traffic metrics currently have documented definitions but no collector.
- The Network Health Index is a heuristic: `100 - 10 * offline device count - 2 * average packet loss - 15 if average latency > 80 ms`, clamped to 0–100. It requires valid latency and loss samples, excludes unknown devices, is not normalized by fleet size, and is **not an SLA**.
- The Reports page exports authenticated inventory, bounded stored telemetry, and recent incidents as CSV or JSON snapshots for 24 hours, 7 days, or 30 days. It does not create archived reports or certify SLAs. CSV fields are quoted and spreadsheet-formula-leading text is neutralized.
- Prometheus/Grafana and the reproducible research experiment workflow are deferred. The current metric registry and bounded observations provide a foundation, not completed experimental results or a novelty claim.
- The scheduler and discovery guard are process-local. Run one backend process only; multiple replicas would need a distributed lease and shared rate limiter before production use.

## Interface preview and safe discovery

- The administrator-only `GET /api/devices/network-interfaces` endpoint and Devices page show local interface name, link status/type when available, IPv4/netmask/CIDR, IPv6 addresses, and default gateway metadata. Detection reads local OS interface/route information only; it does not initiate probes.
- Discovery requires an active, approved private subnet registry record, with no more than 256 usable hosts. Legacy authorization mode also requires the exact canonical CIDR in `DISCOVERY_ALLOWLIST`. Admins can select application-managed authorization and optionally authorize connected interfaces by explicitly scoped interface types and host cap. Interface synchronization registers approved subnets but never starts a scan or enables monitoring; admins explicitly start discovery or configure a schedule. IPv6 is preview-only.
- The administrator-managed subnet registry is available from the **Subnet Management** page and `GET /api/subnets`. New subnets are active but pending approval; registering or approving one never starts discovery. Editors can calculate canonical network details and manage status/approval without probing.
- Subnet CIDRs must be canonical IPv4 networks, not overlap unsafe special-purpose ranges, and contain no more than 256 usable hosts. `/24` has 256 total addresses and 254 usable hosts; `/30` has 4 total and 2 usable; `/31` treats both addresses as usable; `/32` represents one address. Overlaps are rejected unless an administrator explicitly enables the overlap exception and supplies a reason, which is stored and logged.
- Subnet registry authorization is mandatory for discovery and real monitoring. Application-managed mode removes the architectural dependency on `DISCOVERY_ALLOWLIST` and `MONITORING_TARGET_ALLOWLIST`; the registries still require an active approved private subnet, approved device enrollment, explicit monitoring enablement, emergency stop off, and bounded probe policies. Empty environment configuration never grants access. The legacy mode remains available for migration.
- Per-subnet auto-enrollment, enrollment approval, monitoring authorization, and scheduled discovery are configurable and default off (enrollment approval defaults on when auto-enrollment is enabled). A new schedule waits one configured interval before its first run. Discovery runs have bounded host count, concurrency, probe rate, duplicate-job protection, persisted results, progress events, and cancellation. `GET /api/devices/discovery/jobs` returns the latest 20 jobs; `POST /api/devices/discovery/jobs/:id/cancel` requests cancellation. MongoDB expires job records after 90 days.

### Subnet management API

All endpoints require a valid bearer token. Viewers may use the read-only `GET` endpoints; every write endpoint requires an administrator role.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/subnets` | List registered subnets and approval metadata |
| `POST` | `/api/subnets` | Register a pending subnet; does not probe |
| `GET` | `/api/subnets/:id` | Read a subnet |
| `PUT` | `/api/subnets/:id` | Edit subnet metadata/CIDR/status; changing CIDR resets approval |
| `DELETE` | `/api/subnets/:id` | Delete unless a discovery job for that CIDR is running |
| `POST` | `/api/subnets/:id/approve` | Record administrator approval |
| `POST` | `/api/subnets/:id/disable` | Disable a subnet |

Real discovery is `POST /api/devices/discover` with an approved `subnetId` (or its exact registered `cidr`). Admin-only `PUT /api/subnets/:id` controls `autoEnroll`, `requireEnrollmentApproval`, `monitoringEnabled`, `discoveryScheduleEnabled`, and `discoveryIntervalMinutes` (15–10080). Admin-only `PUT /api/devices/:id` controls `enrollmentStatus` and `monitoringStatus`. Device monitoring additionally checks the active approved subnet at collection time, so disabling or editing a subnet immediately removes its authorization.

### Application-managed network authorization

The `NETWORK_AUTHORIZATION_POLICY` setting is persisted in MongoDB and changed through the administrator-only Engine Settings page/API. Legacy mode (the migration-safe default) retains the existing environment allowlists. Application-managed mode removes their per-IP/CIDR checks for both discovery and monitoring; it does not remove subnet authorization or imply an unrestricted target set.

1. Review existing subnet registrations and environment allowlists with the network administrator. Pending, disabled, public, loopback, and unregistered ranges remain unauthorized.
2. Select **Application-managed subnet authorization**. For connected-interface auto-authorization, explicitly enable the feature, select interface types, and choose a maximum usable-host count no greater than 256. Virtual/VPN interfaces are not included unless selected.
3. Use **Synchronize connected networks now** to immediately refresh interface authorization. The backend also refreshes this policy once per minute. Eligible networks must be active, supported interfaces with a canonical RFC1918 IPv4 CIDR; public, link-local, multicast, loopback, unknown, down, unsafe, oversized, and overlapping networks are rejected or left unauthorised. A conflicting pending/disabled subnet is never auto-approved.
4. Auto-authorized subnet records have enrollment approval required, auto-enrollment off, monitoring disabled, and discovery schedules off. Synchronization performs no probes. Administrators must explicitly start discovery or configure a schedule; registering or approving a subnet never starts a scan.
5. To monitor an enrolled device, approve enrollment, enable monitoring on its subnet, and explicitly enable monitoring on the device. Application-managed mode removes only the environment allowlist requirement; it does not override these controls.
6. Leave simulation mode on while configuring. Disable simulation and emergency stop only for an authorized test window. Emergency stop, bounded concurrency/rates, per-subnet cooldown, and cancellation remain in force.

For staged migration, select application-managed mode only after reviewing the subnet registry and enabling explicit scope; the old `DISCOVERY_AUTHORIZATION_MODE` setting still applies when no unified policy has been stored. To return to legacy behavior, select **Legacy: approved subnets + environment allowlists** and populate only approved ranges in the environment. Empty allowlists never permit unrestricted discovery or monitoring.

`POST /api/devices/network-interfaces/synchronize` is admin-only and performs authorization sync only. Network interface preview is `GET /api/devices/network-interfaces`. Settings use `GET/PUT /api/settings`. Admins can manage subnets using `GET/POST /api/subnets`, `GET/PUT/DELETE /api/subnets/:id`, `POST /api/subnets/:id/approve`, and `POST /api/subnets/:id/disable`. Start manual discovery with `POST /api/devices/discover` and an approved `subnetId`; inspect jobs with `GET /api/devices/discovery/jobs` and cancel one with `POST /api/devices/discovery/jobs/:id/cancel`. No schedule is enabled by default.

Example registration body:

```json
{
  "name": "Engineering",
  "cidr": "192.168.50.0/24",
  "location": "Building A",
  "department": "Engineering",
  "description": "Approved address allocation"
}
```

Overlap exceptions require `"allowOverlap": true` and a non-empty `overlapPermissionReason`; the admin identity and reason are retained. The API rejects malformed/noncanonical CIDRs, special-purpose ranges, and subnets above the existing 256-usable-host bound. Subnet records authorize discovery only when active and approved; they do not themselves initiate a scan.

## Metric coverage

`GET /api/metrics/coverage` returns aggregate coverage and per-device summaries. Add `?device=<device-id>` for the device's metric rows. Each row includes value/unit, source, support, last collection time, freshness, duration, status, error code, and reason. Statuses distinguish `AVAILABLE`, `SIMULATED`, `UNSUPPORTED`, `NOT_CONFIGURED`, `AUTHENTICATION_FAILED`, `UNREACHABLE`, `TIMEOUT`, `COLLECTION_ERROR`, `PENDING`, and `STALE` (the legacy `UNAVAILABLE` state remains for policy-blocked or unclassified samples). Missing measurements remain `null`, never zero. Coverage counts only collector-supported metrics; registry presence is not evidence that a device supports a metric.

Admins can use **Test Telemetry** on device details, or `POST /api/devices/:id/telemetry/test`. The diagnostic checks only the selected device and requires live mode, an administrator-approved target, emergency stop off, and SNMP configuration. It has a per-device cooldown and bounded SNMP requests; queried OIDs, SNMP version, status, values/units, timestamp, and device/interface identity are stored without credentials. A successful SNMP response does not imply CPU, memory, or temperature support.

## Metrics

The backend registry contains 38 definitions with source, formula, unit, timestamp, collection method, applicability, and limitations. Fetch all definitions or filter by category:

```text
GET /api/metrics/registry
GET /api/metrics/registry?category=connectivity
```

Both endpoints require authentication. Definitions are maintained in `server/config/metricsRegistry.js`. A metric's presence in the registry does not imply that a collector currently supports it; unsupported values remain `null` and include an unavailability reason where available.

## Safe configuration

1. Copy `server/.env.example` to `server/.env` without overwriting an existing file.
2. Set `MONGO_URI` and a private `JWT_SECRET` of at least 32 characters. Do not commit `.env`.
3. Keep `MONITORING_TARGET_ALLOWLIST` and `DISCOVERY_ALLOWLIST` empty unless operating in legacy authorization mode. In that mode, configure only administrator-approved IPv4 addresses/CIDRs.
4. Network authorization defaults to `legacy_allowlists` for backward compatibility. An administrator can switch to application-managed mode in Engine Settings; this uses approved subnet records instead of per-IP environment entries and still requires explicit private subnet authorization, approved enrollment, emergency stop off, the 256-host limit, bounded concurrency/rate, and cooldown. Optional connected-interface auto-authorization is limited by the administrator-selected interface types and host cap. Empty or missing settings never permit arbitrary targets.
5. `MONITORING_MAX_CONCURRENCY` and `MONITORING_MAX_PROBES_PER_SECOND` are clamped to 1–10. Discovery settings are clamped to concurrency 1–4 and 1–4 probe starts per second. Per-device polling intervals are bounded to 10–3600 seconds.
6. The administrator-only Emergency Stop setting prevents new monitoring and discovery probes. An already-running OS ping cannot be forcibly interrupted by the current ping library; cancellation stops subsequent probes and each active probe is timeout-bounded.
7. Simulation mode is on by default. Turning it off does not authorize a target: monitoring still requires the approved-subnet registry, approved device enrollment, and explicit device/subnet monitoring enablement. Legacy mode additionally requires `MONITORING_TARGET_ALLOWLIST`.

8. For application-managed authorization, select **Application-managed subnet authorization** in Engine Settings. To automatically register connected networks, enable automatic interface authorization and choose the allowed Wi-Fi, Ethernet, hotspot, and/or virtual interface types. The host cap cannot exceed 256 usable addresses. The backend refreshes interface authorization once per minute; **Synchronize connected networks now** performs the same authorization-only refresh immediately. Virtual/VPN interfaces are excluded unless explicitly selected. Only active interfaces with canonical RFC1918 IPv4 ranges are eligible; loopback, link-local, multicast, public, unknown, and oversized networks are rejected.
9. Interface authorization creates active, approved subnet records with enrollment approval on, auto-enrollment off, monitoring disabled, and discovery scheduling off. A connected-network authorization is revalidated before discovery and expires if link state is not refreshed. Discovery still requires an explicit admin action or previously configured schedule. Monitoring each discovered device still requires approved enrollment, subnet monitoring enabled, and that device's monitoring switch enabled.

The example `.env.example` contains placeholders, not production credentials. SNMPv3 is configurable per device with a security name, level, authentication protocol/key, and privacy protocol/key. SNMP community strings and v3 keys are AES-256-GCM encrypted in MongoDB, excluded from device API/socket responses and logs, and decrypted only when creating an SNMP session. Set `SNMP_CREDENTIAL_ENCRYPTION_KEY` to a private base64-encoded 32-byte key from a secret manager before creating or updating SNMP credentials. Back up the key separately from the database; losing it makes encrypted credentials unrecoverable. Do not rotate the key without an explicit re-encryption procedure.

For existing plaintext credentials, back up MongoDB and provision the key first, then run `node scripts\encryptSnmpCredentials.js` from `server` during a maintenance window. The migration is idempotent, updates only the SNMP community/authentication/privacy fields, and reports counts without printing secrets. Keep the key stable and available to every backend instance. Legacy plaintext values remain readable during staged migration, but should be migrated before production use.

## Initial setup

Requirements: Node.js 18+, MongoDB, and (for real ICMP) the platform ping executable.

In PowerShell:

```powershell
Copy-Item server\.env.example server\.env
# Edit server\.env: set MONGO_URI and a private JWT_SECRET (32+ characters).
# Set SNMP_CREDENTIAL_ENCRYPTION_KEY from a secret manager before configuring SNMP credentials.
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

## Remote site collector

1. Register and approve a private subnet (maximum 256 usable hosts), then enable its monitoring policy.
2. In **Site Collectors**, create one collector for that subnet and copy its bearer token immediately. The token is stored only as a SHA-256 hash and cannot be viewed again; revoke and replace it if lost or exposed.
3. Configure the standalone agent from [`collector/README.md`](./collector/README.md) with its HTTPS backend URL, token, and exact approved CIDR. The agent scans and reports only that scope. Newly discovered addresses enter inventory as pending and are not monitored until approved and enabled.
4. Collector-managed devices are excluded from local polling. Revoking the collector releases its device assignments back to the local engine.

The backend must be reachable through a trusted HTTPS endpoint from the site. Do not expose the development backend directly to the internet. Real Prepare.sh persistence and remote device integration remain **not verified** until an HTTPS route and lab host are available.

## API history limits

- `GET /api/devices/:id/metrics?range=1h|6h|24h|7d` uses the indexed device/timestamp query and returns at most 1,000 newest samples.
- `GET /api/analytics/performance?range=1h|6h|24h|7d|30d` returns at most 500 samples.
- `GET /api/alerts?device=<id>` returns at most 100 most recently updated incidents for that device.
- Device inventory returns at most 500 devices with recent metric summaries and active-alert counts.

All these routes require authentication. Device enrollment, edits, deletion, discovery, and settings updates require administrator authorization. Public registration creates viewer accounts only.

## Verification

Run backend tests with `Set-Location server; npm test`, frontend tests with `Set-Location client; npm test`, frontend lint with `Set-Location client; npm run lint`, and production build with `Set-Location client; npm run build`. Tests use mocked probes; they do not scan networks.
