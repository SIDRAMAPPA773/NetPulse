const definition = (id, name, category, level, source, formula, unit, collectionMethod, applicability, limitations) => ({
  id,
  name,
  category,
  level,
  source,
  formula,
  unit,
  timestamp: 'Metric.createdAt (UTC)',
  collectionMethod,
  applicability,
  limitations,
});

const METRICS = [
  definition('device_reachability', 'Device reachability', 'connectivity', 'device', 'ICMP', 'At least one echo reply in the probe window', 'boolean', 'Bounded ICMP echo probes', 'Targets that permit ICMP', 'ICMP filtering can appear as unreachable.'),
  definition('rtt_average', 'Average round-trip time', 'connectivity', 'device', 'ICMP', 'Sum of successful RTT samples / successful sample count', 'ms', 'Arithmetic mean of successful probe RTTs', 'At least one RTT sample', 'Excludes timed-out probes.'),
  definition('rtt_minimum', 'Minimum round-trip time', 'connectivity', 'device', 'ICMP', 'Minimum successful RTT sample', 'ms', 'Minimum of successful probe RTTs', 'At least one RTT sample', 'Depends on probe window and host scheduling.'),
  definition('rtt_maximum', 'Maximum round-trip time', 'connectivity', 'device', 'ICMP', 'Maximum successful RTT sample', 'ms', 'Maximum of successful probe RTTs', 'At least one RTT sample', 'Depends on probe window and host scheduling.'),
  definition('rtt_stddev', 'RTT standard deviation', 'connectivity', 'device', 'ICMP', 'Population standard deviation of successful RTT samples', 'ms', 'Square root of mean squared deviation from RTT mean', 'At least one RTT sample', 'Small sample windows are not representative.'),
  definition('rtt_jitter', 'RTT jitter', 'connectivity', 'device', 'ICMP', 'Mean absolute difference between consecutive successful RTT samples', 'ms', 'Mean(|RTT[i] - RTT[i-1]|)', 'At least two successful RTT samples', 'RTT variation is not one-way IPDV.'),
  definition('packet_loss', 'Packet loss', 'connectivity', 'device', 'ICMP', '(Sent probes - successful replies) / sent probes * 100', '%', 'Probe outcomes per polling window', 'At least one attempted probe', 'Short windows have coarse resolution.'),
  definition('availability', 'Availability', 'connectivity', 'device', 'ICMP', 'Successful echo replies / attempted echo requests * 100 over one polling observation window', '%', 'Aggregate probe outcomes within the recorded polling window', 'At least one attempted echo request in the window', 'Per-cycle result, not a long-term SLA; aggregate windows for long-term availability.'),
  definition('inbound_throughput', 'Inbound throughput', 'traffic', 'interface', 'SNMP IF-MIB', 'Counter delta octets * 8 / elapsed seconds', 'bit/s', 'Rate from valid inbound-octet counter deltas', 'Configured, supported interface and valid counter pair', 'Unavailable on reset, missing counter, or unknown interface.'),
  definition('outbound_throughput', 'Outbound throughput', 'traffic', 'interface', 'SNMP IF-MIB', 'Counter delta octets * 8 / elapsed seconds', 'bit/s', 'Rate from valid outbound-octet counter deltas', 'Configured, supported interface and valid counter pair', 'Unavailable on reset, missing counter, or unknown interface.'),
  definition('inbound_packet_rate', 'Inbound packet rate', 'traffic', 'interface', 'SNMP IF-MIB', 'Inbound packet counter delta / elapsed seconds', 'packets/s', 'Rate from valid inbound packet counter deltas', 'Configured, supported interface and valid counter pair', 'Unavailable if counters are absent or reset.'),
  definition('outbound_packet_rate', 'Outbound packet rate', 'traffic', 'interface', 'SNMP IF-MIB', 'Outbound packet counter delta / elapsed seconds', 'packets/s', 'Rate from valid outbound packet counter deltas', 'Configured, supported interface and valid counter pair', 'Unavailable if counters are absent or reset.'),
  definition('inbound_interface_errors', 'Inbound interface errors', 'traffic', 'interface', 'SNMP IF-MIB', 'Raw inbound error counter', 'errors', 'SNMP counter sample', 'Configured interface supports IF-MIB errors', 'Cumulative counter; not a rate.'),
  definition('outbound_interface_errors', 'Outbound interface errors', 'traffic', 'interface', 'SNMP IF-MIB', 'Raw outbound error counter', 'errors', 'SNMP counter sample', 'Configured interface supports IF-MIB errors', 'Cumulative counter; not a rate.'),
  definition('inbound_dropped_packets', 'Inbound dropped packets', 'traffic', 'interface', 'SNMP IF-MIB', 'Raw inbound discard counter', 'packets', 'SNMP counter sample', 'Configured interface supports IF-MIB discards', 'Cumulative counter; not a rate.'),
  definition('outbound_dropped_packets', 'Outbound dropped packets', 'traffic', 'interface', 'SNMP IF-MIB', 'Raw outbound discard counter', 'packets', 'SNMP counter sample', 'Configured interface supports IF-MIB discards', 'Cumulative counter; not a rate.'),
  definition('interface_utilization', 'Interface utilization', 'traffic', 'interface', 'SNMP IF-MIB', 'Throughput bit/s / known interface speed bit/s * 100', '%', 'Derived from valid throughput and interface speed', 'Valid throughput and non-zero known interface speed', 'Can exceed 100% due to speed changes or counter sampling.'),
  definition('device_uptime', 'Device uptime', 'health', 'device', 'SNMP SNMPv2-MIB', 'sysUpTime timeticks / 100', 'seconds', 'SNMP sysUpTime sample', 'Device supports and allows sysUpTime', 'Timeticks wrap after approximately 497 days.'),
  definition('cpu_utilization', 'CPU utilization', 'health', 'device', 'SNMP vendor MIB or authorized agent', 'Provider-specific busy CPU percentage', '%', 'Supported device-specific OID/agent only', 'Explicitly configured and supported source', 'No portable universal CPU OID; otherwise unavailable.'),
  definition('memory_utilization', 'Memory utilization', 'health', 'device', 'SNMP vendor MIB or authorized agent', 'Used bytes / total bytes * 100', '%', 'Supported device-specific OID/agent only', 'Explicitly configured and supported source', 'No portable universal memory OID; otherwise unavailable.'),
  definition('tcp_service_availability', 'TCP service availability', 'service', 'service', 'TCP connect', 'Successful authorized connection / attempts', '%', 'Bounded connect to an administrator-approved port', 'Explicitly approved service/port', 'Not collected unless a service is configured.'),
  definition('service_response_time', 'Service response time', 'service', 'service', 'TCP connect', 'Connection completion time - connection start time', 'ms', 'Monotonic-clock connect timing', 'Explicitly approved service/port', 'Connect time does not measure application response.'),
  definition('dns_response_time', 'DNS query response time', 'service', 'service', 'DNS resolver', 'DNS response completion time - query start time', 'ms', 'Bounded query to configured resolver', 'Configured hostname and resolver', 'Resolver/cache effects influence results.'),
  definition('route_hop_count', 'Route hop count', 'path', 'path', 'Traceroute', 'Number of observable responding route hops', 'hops', 'Bounded route trace', 'Authorized target and supported OS/network', 'ICMP/UDP filtering can hide intermediate hops.'),
  definition('route_hop_response_time', 'Route hop response time', 'path', 'path', 'Traceroute', 'RTT to an observable intermediate hop', 'ms', 'Bounded route trace probe', 'Authorized target and observable hop', 'Intermediate response may be rate-limited.'),
  definition('probe_count', 'Probe count', 'engine', 'monitoring-system', 'Monitoring engine', 'Count of probe attempts in the observation window', 'probes', 'Engine outcome counters', 'Monitoring engine running', 'Includes only probes tracked by this process.'),
  definition('probe_rate', 'Probe rate', 'engine', 'monitoring-system', 'Monitoring engine', 'Probe attempts / elapsed seconds', 'probes/s', 'Engine counters over a time window', 'Monitoring engine running', 'Does not include unobserved external probes.'),
  definition('discovery_duration', 'Discovery duration', 'engine', 'monitoring-system', 'Discovery worker', 'Discovery completion time - start time', 'ms', 'Monotonic-clock job timing', 'An explicitly authorized discovery job', 'No value until a discovery job is run.'),
  definition('polling_duration', 'Polling execution duration', 'engine', 'monitoring-system', 'Monitoring engine', 'Polling completion time - start time', 'ms', 'Monotonic-clock cycle timing', 'Monitoring cycle runs', 'Includes queue wait and configured probe work.'),
  definition('engine_cpu_utilization', 'Monitoring-engine CPU utilization', 'engine', 'monitoring-system', 'Operating system process metrics', 'Process CPU time / wall time * 100', '%', 'Process CPU usage sampling', 'Platform exposes process CPU accounting', 'Process-level estimate, not host-wide CPU.'),
  definition('engine_memory_usage', 'Monitoring-engine memory usage', 'engine', 'monitoring-system', 'Operating system process metrics', 'Resident set size', 'bytes', 'Process memory sample', 'Monitoring engine running', 'Process memory is not network-device memory.'),
  definition('monitoring_traffic_volume', 'Monitoring traffic volume', 'engine', 'monitoring-system', 'Interface counters or estimate', 'Measured counter delta, or estimated bytes from known probe sizes', 'bytes', 'Measured/estimated with explicit source metadata', 'Source can be measured or safely estimated', 'ICMP payload/wire overhead may not be measurable.'),
  definition('monitoring_failures', 'Monitoring failures', 'engine', 'monitoring-system', 'Monitoring engine', 'Count of failed collection attempts', 'failures', 'Collector outcomes', 'Monitoring engine running', 'Failure classification depends on collector.'),
  definition('monitoring_timeouts', 'Monitoring timeouts', 'engine', 'monitoring-system', 'Monitoring engine', 'Count of timed-out collection attempts', 'timeouts', 'Collector timeout outcomes', 'Monitoring engine running', 'Timeouts can be caused by filtering or overload.'),
  definition('monitoring_rate_limit_events', 'Monitoring rate-limit events', 'engine', 'monitoring-system', 'Monitoring engine', 'Count of attempts delayed or denied by configured rate limits', 'events', 'Rate-limiter outcomes', 'Rate limiting enabled', 'Delay and denial policies must be distinguished.'),
];

const METRICS_REGISTRY = METRICS.reduce((registry, metric) => {
  if (!registry[metric.category]) registry[metric.category] = [];
  registry[metric.category].push(metric);
  return registry;
}, {});

const getAll = () => METRICS.slice();
const getByCat = (category) => METRICS_REGISTRY[category] || [];

module.exports = { METRICS_REGISTRY, getAll, getByCat };
