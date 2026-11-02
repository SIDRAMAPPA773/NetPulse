# NetPulse site collector

This standalone Node.js process performs a bounded ICMP scan of one explicitly
authorized RFC1918 IPv4 subnet, then sends a heartbeat and one observation for
each usable address to the configured backend. It uses only Node.js built-ins;
no package installation is required.

## Requirements and configuration

- Linux with Node.js 18 or newer and the `ping` utility available to the service
  account.
- An outbound network route to a trusted backend HTTPS endpoint. The backend
  certificate and hostname must validate normally; do not disable TLS
  verification or point the collector at an untrusted/intercepting endpoint.
- `NETPULSE_BACKEND_URL`: HTTPS origin or base path, without credentials,
  query, or fragment. The collector appends `/api/collectors/ingest/heartbeat`
  and `/api/collectors/ingest/report`.
- `NETPULSE_TOKEN`: bearer token provisioned for this collector. It is sent only
  in the HTTPS `Authorization` header and is never logged.
- `NETPULSE_SUBNET_CIDR`: canonical IPv4 network CIDR wholly inside RFC1918
  space. The collector rejects scopes with more than 256 usable addresses and
  scans only their usable host addresses (network/broadcast addresses are
  excluded except for `/31` and `/32`).
- Optional `NETPULSE_INTERVAL_SECONDS` (default `60`, minimum `15`, maximum
  `3600`), `NETPULSE_SCAN_CONCURRENCY` (default `16`, maximum `32`), and
  `NETPULSE_SCAN_RATE` (default `20`, maximum `50` probes/second).

Provision secrets out of band using the host's secret manager or a root-owned
environment file. Do not put live tokens in shell history, source control, or
world-readable files. For an environment file, restrict access (for example,
owner `root`, group the dedicated service group, mode `0640`) and ensure only
the service account can read it. Prefer a systemd credential where available.

## Run manually

From this directory, provide the environment securely and run:

```sh
node index.js
```

Missing or invalid required configuration causes a clear startup error and a
nonzero exit. `npm start` is also available without installing dependencies.
The collector handles `SIGINT` and `SIGTERM` for orderly shutdown.

## systemd-like operation

Install this directory at a fixed path such as `/opt/netpulse-collector` and
adapt the service account, environment file, and paths to the host's policy:

```ini
[Unit]
Description=NetPulse site collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=netpulse-collector
Group=netpulse-collector
WorkingDirectory=/opt/netpulse-collector
EnvironmentFile=/etc/netpulse-collector/collector.env
ExecStart=/usr/bin/node /opt/netpulse-collector/index.js
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

The configured backend must be reachable over outbound HTTPS and trusted by
the host's normal CA store. This collector does not open a listening port and
does not provide an inbound control channel. Scope it only to networks the
operator is authorized to monitor.

## Behavior and tests

Scanning has a hard concurrency and rate ceiling; each `ping` is launched with
an argument array and a finite process timeout. Invalid RTTs are reported as
unreachable. HTTPS requests have a finite timeout and bounded response size.
Failed delivery uses at most three attempts with bounded exponential backoff.
Unsent reports remain in a three-entry in-memory queue; when full, the oldest
report is dropped with a warning. A process restart clears that in-memory
queue.

Run mocked/unit tests without network access or dependencies:

```sh
npm test
```
