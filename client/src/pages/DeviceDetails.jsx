import React, { useContext, useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { 
  ArrowLeft, 
  Server, 
  Activity, 
  Cpu, 
  HardDrive, 
  AlertTriangle,
  Router,
  ShieldCheck,
  Radio,
  Thermometer,
  Layers,
  Heart,
  Network,
  Printer,
  Laptop
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';
import { AuthContext } from '../context/AuthContext';

const formatBitRate = (value) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Not collected';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} Gbit/s`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbit/s`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} kbit/s`;
  return `${value.toFixed(0)} bit/s`;
};

const formatBytes = (bytes) => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return 'Not collected';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const formatTimestamp = (value) => {
  if (!value) return 'None recorded';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
};

const formatInterfaceStatus = (value) => ({
  1: 'up',
  2: 'down',
  3: 'testing',
  4: 'unknown',
  5: 'dormant',
  6: 'not present',
  7: 'lower-layer down',
}[value] || (value == null ? 'Not collected' : `Unrecognized state (${value})`));

const getDeviceIcon = (type) => {
  switch (type) {
    case 'router': return <Router className="w-5 h-5 text-sky-600" />;
    case 'switch': return <Network className="w-5 h-5 text-indigo-600" />;
    case 'server': return <Server className="w-5 h-5 text-emerald-600" />;
    case 'pc': return <Laptop className="w-5 h-5 text-slate-600" />;
    case 'printer': return <Printer className="w-5 h-5 text-amber-600" />;
    case 'ap': return <Radio className="w-5 h-5 text-purple-600" />;
    default: return <Server className="w-5 h-5 text-slate-500" />;
  }
};

const DeviceDetails = () => {
  const { id } = useParams();
  const { user } = useContext(AuthContext);
  const [device, setDevice] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [latestCollection, setLatestCollection] = useState(null);
  const [latestSuccessfulMeasurement, setLatestSuccessfulMeasurement] = useState(null);
  const [metricCoverage, setMetricCoverage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [range, setRange] = useState('1h');
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  const [diagnosticMessage, setDiagnosticMessage] = useState('');
  const [selectedInterfaceIndex, setSelectedInterfaceIndex] = useState('');

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const [deviceRes, metricsRes, alertsRes, coverageRes] = await Promise.all([
          api.get(`/devices/${id}`),
          api.get(`/devices/${id}/metrics?range=${range}`),
          api.get(`/alerts?device=${id}`),
          api.get(`/metrics/coverage?device=${id}`)
        ]);
        if (!active) return;
        setDevice(deviceRes.data);
        setMetrics(metricsRes.data);
        setAlerts(alertsRes.data);
        setMetricCoverage(coverageRes.data);
        setLatestCollection(deviceRes.data.latestCollection);
        setLatestSuccessfulMeasurement(deviceRes.data.latestSuccessfulMeasurement);
        setSelectedInterfaceIndex(deviceRes.data.snmpInterfaceIndex
          ? String(deviceRes.data.snmpInterfaceIndex)
          : '');
        setLoadError('');
      } catch (error) {
        if (active) {
          console.error('Error fetching device data', error);
          setLoadError('Unable to load device telemetry. Check the connection and try again.');
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchData();

    const socket = getSocket();
    const handleDeviceUpdated = (updatedDevice) => {
      if (updatedDevice._id === id) setDevice(updatedDevice);
    };
    const handleMetricAdded = (newMetric) => {
      const metricDeviceId = typeof newMetric.device === 'object' ? newMetric.device?._id : newMetric.device;
      if (metricDeviceId === id) {
        setMetrics(prev => [newMetric, ...prev].slice(0, 50));
        setLatestCollection(newMetric);
      }
    };

    if (socket) {
      socket.on('deviceUpdated', handleDeviceUpdated);
      socket.on('metricAdded', handleMetricAdded);
    }

    return () => {
      active = false;
      if (socket) {
        socket.off('deviceUpdated', handleDeviceUpdated);
        socket.off('metricAdded', handleMetricAdded);
      }
    };
  }, [id, range]);

  if (loading) {
    return (
      <div className="space-y-6 pb-12 w-full min-w-0">
        <div className="h-10 w-48 bg-slate-200 animate-pulse rounded-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="h-72 bg-slate-100 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (loadError || !device) {
    return (
      <div className="py-16 text-center text-sm text-rose-700">
        <p>{loadError || 'Device not found.'}</p>
        <Link to="/devices" className="mt-3 inline-block px-4 py-2 rounded-xl border border-rose-300 font-semibold">
          Return to devices list
        </Link>
      </div>
    );
  }

  const realMetrics = metrics.filter(metric => (
    metric.measurementSource === 'real'
    && metric.validity === 'valid'
    && ['success', 'timeout'].includes(metric.collectionStatus)
  ));
  const chartData = [...realMetrics].reverse().map(m => ({
    time: format(new Date(m.createdAt), range === '1h' ? 'HH:mm:ss' : 'MMM d HH:mm'),
    latency: m.latency ?? null,
    packetLoss: m.packetLoss ?? null,
    cpu: m.cpuUtilization ?? null,
    memory: m.memoryUtilization ?? null
  }));

  const latestMetric = latestCollection || metrics[0] || {};
  const latestDerived = latestMetric.derived || {};
  const isUp = device.status === 'UP';
  const isDown = device.status === 'DOWN';
  const monitoringState = !device.monitoringStatus
    ? 'Monitoring disabled'
    : device.enrollmentStatus !== 'approved'
      ? 'Enrollment pending'
      : !device.monitoringAuthorized
        ? 'Monitoring authorization blocked'
        : 'Monitoring enabled';
  const isAllowlistBlocked = latestMetric.reasonUnavailable === 'Target is not in MONITORING_TARGET_ALLOWLIST';
  const latestSuccessfulSample = latestSuccessfulMeasurement
    || realMetrics.find(metric => metric.availabilityStatus === 'available' && metric.reachability?.isReachable === true);
  const lastSuccessfulAt = latestSuccessfulSample?.createdAt;
  const isLastSuccessfulMeasurementStale = lastSuccessfulAt
    && latestMetric.createdAt
    && new Date(latestMetric.createdAt).getTime() > new Date(lastSuccessfulAt).getTime();

  const hasLatestPollFailure = latestMetric.availabilityStatus === 'unavailable'
    || latestMetric.reachability?.isReachable === false;
  const collectionExplanation = (() => {
    if (isAllowlistBlocked) {
      return 'No ICMP probe was run because this target is not authorized by MONITORING_TARGET_ALLOWLIST. This is an authorization block, not evidence that the device is unreachable.';
    }
    if (latestMetric.reachability?.isReachable === false) {
      return 'The authorized poll completed, but the device did not respond. Packet loss and latency reflect this failed reachability check.';
    }
    if (latestMetric.collectionStatus === 'timeout' || latestMetric.collectionStatus === 'unreachable') {
      return 'The latest authorized ICMP poll did not receive a response.';
    }
    if (latestMetric.reasonUnavailable) return latestMetric.reasonUnavailable;
    if (latestMetric.collectionStatus === 'unsupported') return 'The latest telemetry collection is unsupported.';
    if (latestMetric.collectionStatus === 'error') return 'The latest telemetry collection failed with an error.';
    return null;
  })();

  const hardware = latestMetric.hardware || {};
  const health = latestMetric.health || {};
  const reasonForMetric = (metricId, fallback) => (
    latestDerived.unavailableMetrics?.[metricId]
    || latestMetric.snmp?.oidChecks?.find(check => check.metricId === metricId)?.reason
    || fallback
  );
  const hasCurrentHealthEvidence = latestMetric.measurementSource === 'real'
    && latestMetric.validity === 'valid'
    && ['success', 'timeout'].includes(latestMetric.collectionStatus)
    && Number.isFinite(health.coveragePercent)
    && health.overallScore !== null
    && health.overallScore !== undefined;
  const overallHealthScore = hasCurrentHealthEvidence ? health.overallScore : null;
  const healthStatus = hasCurrentHealthEvidence ? health.healthStatus || 'Unknown' : 'Unknown';
  const componentEvidence = (name) => health.breakdown?.find(component => component.name === name)?.coveragePercent;
  const telemetryDiagnostics = device.telemetryDiagnostics || (
    latestMetric.snmp?.oidChecks?.length
      ? {
        status: latestMetric.snmp.responded ? 'AVAILABLE' : latestMetric.snmp.errorCode || 'UNAVAILABLE',
        reason: latestMetric.snmp.reason,
        snmpVersion: device.snmpVersion,
        collectedAt: latestMetric.createdAt,
        checks: latestMetric.snmp.oidChecks,
      }
      : null
  );
  const snmpPollStatus = latestMetric.snmp
    ? latestMetric.snmp.responded
      ? 'AVAILABLE'
      : latestMetric.snmp.errorCode || (latestMetric.snmp.supported ? 'UNAVAILABLE' : 'NOT CONFIGURED')
    : device.monitoringMethod === 'snmp' ? 'NOT TESTED' : 'NOT_CONFIGURED';
  const snmpPollReason = latestMetric.snmp?.reason
    || latestMetric.snmp?.errorCode
    || null;
  const latestPollTimestamp = latestMetric.createdAt ? new Date(latestMetric.createdAt).getTime() : 0;
  const diagnosticTimestamp = telemetryDiagnostics?.collectedAt
    ? new Date(telemetryDiagnostics.collectedAt).getTime()
    : 0;
  const pendingConfigurationTimestamp = telemetryDiagnostics?.status === 'NOT_TESTED'
    && !telemetryDiagnostics?.collectedAt
    && device.updatedAt
    ? new Date(device.updatedAt).getTime()
    : 0;
  const latestSnmpPollIsNewer = Boolean(
    latestMetric.snmp
    && latestPollTimestamp >= Math.max(diagnosticTimestamp, pendingConfigurationTimestamp),
  );
  const displayedSnmpStatus = latestSnmpPollIsNewer
    ? snmpPollStatus
    : telemetryDiagnostics?.status || snmpPollStatus;
  const displayedSnmpReason = latestSnmpPollIsNewer
    ? snmpPollReason
    : telemetryDiagnostics?.reason || snmpPollReason;
  const telemetryCollector = (key, fallbackStatus, fallbackReason) => [
    latestSnmpPollIsNewer
      ? fallbackStatus
      : telemetryDiagnostics?.collectors?.[key]?.status || fallbackStatus,
    latestSnmpPollIsNewer
      ? fallbackReason
      : telemetryDiagnostics?.collectors?.[key]?.reason || fallbackReason,
  ];
  const runTelemetryDiagnostic = async () => {
    setDiagnosticBusy(true);
    setDiagnosticMessage('');
    try {
      const { data } = await api.post(`/devices/${id}/telemetry/test`);
      setDevice((current) => ({ ...current, telemetryDiagnostics: data }));
      setDiagnosticMessage(`Diagnostic completed: ${data.status}`);
    } catch (error) {
      const message = error.response?.data?.reason || error.response?.data?.message
        || 'Unable to run telemetry diagnostic.';
      setDiagnosticMessage(message);
    } finally {
      setDiagnosticBusy(false);
    }
  };
  const saveDiscoveredInterface = async () => {
    if (!selectedInterfaceIndex) return;
    try {
      const { data } = await api.put(`/devices/${id}`, {
        snmpInterfaceIndex: Number(selectedInterfaceIndex),
      });
      setDevice(current => ({ ...current, ...data }));
      setDiagnosticMessage(`SNMP interface ${selectedInterfaceIndex} saved. Counters will be collected on the next authorized poll.`);
    } catch (error) {
      const message = error.response?.data?.message || 'Unable to save the selected SNMP interface.';
      setDiagnosticMessage(message);
    }
  };

  return (
    <div className="w-full min-w-0 space-y-6 pb-12">
      
      {/* Top Breadcrumb & Device Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link 
            to="/devices" 
            className="p-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 transition-colors shadow-2xs cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
                {device.name}
              </h1>
              
              <span className={clsx(
                "px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase flex items-center gap-1.5 border",
                isUp ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                isDown ? "bg-rose-50 text-rose-700 border-rose-200" :
                "bg-amber-50 text-amber-700 border-amber-200"
              )}>
                <span className={clsx(
                  "w-1.5 h-1.5 rounded-full",
                  isUp ? "bg-emerald-500 animate-pulse" :
                  isDown ? "bg-rose-500" : "bg-amber-500"
                )} />
                {device.status}
              </span>

              {overallHealthScore !== null && (
                <span className={clsx(
                  "px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase border flex items-center gap-1",
                  overallHealthScore >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                  overallHealthScore >= 60 ? "bg-amber-50 text-amber-700 border-amber-200" :
                  "bg-rose-50 text-rose-700 border-rose-200"
                )}>
                  Health: {overallHealthScore}% ({healthStatus})
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 mt-1 text-xs flex-wrap">
              <span className="font-mono text-slate-800 font-bold px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                {device.ipAddress}
              </span>
              {device.macAddress && (
                <span className="font-mono text-slate-600 px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                  MAC: {device.macAddress}
                </span>
              )}
              {device.vendor && device.vendor !== 'Unknown' && (
                <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {device.vendor}
                </span>
              )}
              <span className="text-slate-500 capitalize">{device.type}</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500">{device.location || 'Location unassigned'}</span>
            </div>
          </div>
        </div>

        {/* Polling & Protocol badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-slate-600 self-start sm:self-auto font-mono shadow-2xs">
          <Radio className={`w-3.5 h-3.5 ${monitoringState === 'Monitoring enabled' ? 'text-sky-600 animate-pulse' : 'text-slate-400'}`} />
          <span>{monitoringState} · interval {device.pollingInterval || 30}s</span>
          {device.reachabilityMethod && (
            <span className="ml-1 uppercase font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200 text-[10px]">
              {device.reachabilityMethod}
            </span>
          )}
        </div>
      </div>

      <section className="glass-card-static rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Telemetry diagnostics</h2>
            <p className="text-xs text-slate-500">
              Bounded SNMP checks only; live diagnostics require an approved target and simulation mode off.
            </p>
          </div>
          {user?.role === 'admin' && device.monitoringMethod === 'snmp' && (
            <button
              type="button"
              onClick={runTelemetryDiagnostic}
              disabled={diagnosticBusy}
              className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 disabled:cursor-wait disabled:opacity-60"
            >
              {diagnosticBusy ? 'Testing telemetry…' : 'Test Telemetry'}
            </button>
          )}
        </div>
        {diagnosticMessage && <p role="status" className="text-xs text-slate-600">{diagnosticMessage}</p>}
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['SNMP connectivity', displayedSnmpStatus, displayedSnmpReason],
            ['SNMP version', telemetryDiagnostics?.snmpVersion || (device.monitoringMethod === 'snmp' ? device.snmpVersion : 'Not configured'), null],
            ['Agent availability', ...telemetryCollector('agent', 'NOT_CONFIGURED', 'No authenticated Windows or Linux host exporter is configured')],
            ['CPU collector', ...telemetryCollector('cpu', hardware.availability?.cpu || 'UNSUPPORTED', hardware.cpu?.reason || 'No supported CPU collector returned a value')],
            ['Memory collector', ...telemetryCollector('memory', hardware.availability?.memory || 'UNSUPPORTED', hardware.memory?.reason || 'No supported physical-memory collector returned a value')],
            ['Temperature collector', ...telemetryCollector('temperature', hardware.availability?.temperature || 'UNSUPPORTED', hardware.temperature?.reason || 'No supported environmental sensor OID responded')],
            ['Uptime collector', ...telemetryCollector('uptime', hardware.availability?.uptime || 'UNAVAILABLE', hardware.system?.sysUpTime == null ? 'SNMPv2-MIB sysUpTime.0 was not returned' : null)],
            ['Interface collector', ...telemetryCollector('interface', latestMetric.snmp?.countersSupported ? 'AVAILABLE' : device.snmpInterfaceIndex ? 'UNAVAILABLE' : 'NOT_CONFIGURED', latestMetric.snmp?.reason || 'Select a discovered interface index and supported IF-MIB counters')],
          ].map(([label, value, reason]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 break-words font-medium text-slate-800">{value}</p>
              {reason && <p className="mt-1 break-words text-slate-600">{reason}</p>}
            </div>
          ))}
        </div>
        {telemetryDiagnostics?.interfaces?.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-xs font-semibold text-slate-700">
              Discovered SNMP interface
              <select
                value={selectedInterfaceIndex}
                onChange={event => setSelectedInterfaceIndex(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-normal"
              >
                <option value="">Select an interface</option>
                {telemetryDiagnostics.interfaces.map(iface => (
                  <option key={iface.interfaceIndex} value={iface.interfaceIndex}>
                    {iface.interfaceIndex}: {iface.name} · {formatInterfaceStatus(iface.operationalStatus)}
                    {iface.speedBps ? ` · ${formatBitRate(iface.speedBps)}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={saveDiscoveredInterface}
                disabled={!selectedInterfaceIndex || Number(selectedInterfaceIndex) === Number(device.snmpInterfaceIndex)}
                className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save interface
              </button>
            )}
          </div>
        )}
        {telemetryDiagnostics?.interfaceDiscoveryErrors?.length > 0 && (
          <p className="text-xs text-amber-700">
            Interface discovery errors: {telemetryDiagnostics.interfaceDiscoveryErrors.join(', ')}
          </p>
        )}
        <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
          <p>Last successful collection: {formatTimestamp(telemetryDiagnostics?.checks?.find(check => check.responseStatus === 'AVAILABLE')?.collectedAt)}</p>
          <p>Most recent failure: {telemetryDiagnostics?.checks?.find(check => check.reason)?.reason || telemetryDiagnostics?.reason || 'None recorded'}</p>
        </div>
        {telemetryDiagnostics?.checks?.length > 0 && (
          <div className="overflow-x-auto border-t border-slate-100 pt-3">
            <h3 className="mb-2 text-xs font-bold text-slate-700">Supported OID checks</h3>
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead className="text-slate-500">
                <tr><th className="pb-2 pr-3">OID</th><th className="pb-2 pr-3">Result</th><th className="pb-2 pr-3">Value</th><th className="pb-2">Interface</th></tr>
              </thead>
              <tbody>
                {telemetryDiagnostics.checks.map((check, index) => (
                  <tr key={`${check.oid}-${index}`} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-mono">{check.oid}</td>
                    <td className="py-2 pr-3">{check.responseStatus}</td>
                    <td className="py-2 pr-3">{check.value ?? check.reason ?? 'No value returned'}</td>
                    <td className="py-2">{check.interfaceId || 'System'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Freshness & Monitoring Safety Banner */}
      {latestMetric.createdAt && (
        <section
          className={`w-full min-w-0 rounded-2xl border p-4 ${
            isAllowlistBlocked
              ? 'border-amber-200 bg-amber-50'
              : hasLatestPollFailure
                ? 'border-rose-200 bg-rose-50'
                : 'border-slate-200 bg-white'
          }`}
          role="status"
        >
          <h2 className="text-sm font-bold text-slate-900">Monitoring and data freshness</h2>
          {collectionExplanation && (
            <p className="mt-1 break-words text-sm text-slate-700">{collectionExplanation}</p>
          )}
          <div className="mt-2.5 grid min-w-0 gap-2 text-xs text-slate-600 sm:grid-cols-2">
            <p className="min-w-0 break-words">
              Latest observation: {latestMetric.measurementSource || 'unknown'} ({latestMetric.collectionStatus || 'unknown'}) at {formatTimestamp(latestMetric.createdAt)}.
            </p>
            <p className="min-w-0 break-words">
              Last successful measurement: {formatTimestamp(lastSuccessfulAt)}
              {latestSuccessfulSample?.measurementSource ? ` (${latestSuccessfulSample.measurementSource})` : ''}
              {isLastSuccessfulMeasurementStale ? ' — stale; newer successful telemetry has not been recorded' : ''}.
            </p>
          </div>
          {Object.keys(latestMetric.derived?.unavailableMetrics || {}).length > 0 && (
            <ul className="mt-3 grid min-w-0 gap-2 text-xs text-slate-600 sm:grid-cols-2 border-t border-slate-200/60 pt-2.5">
              {Object.entries(latestMetric.derived.unavailableMetrics).map(([metricKey, reason]) => (
                <li key={metricKey} className="min-w-0 break-words">
                  <span className="font-semibold text-slate-700">{metricKey}:</span> {reason}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Device Health Score Breakdown Card */}
      <section className="glass-card-static rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-500" />
              Composite Device Health Assessment
            </h2>
            <p className="text-xs text-slate-500">
              Evaluates available component metrics. Unsupported measurements are excluded without penalizing as zero.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Overall Score:</span>
            <span className={clsx(
              "font-mono text-xl font-extrabold px-3 py-0.5 rounded-xl border",
              overallHealthScore === null ? "bg-slate-100 text-slate-600 border-slate-200" :
              overallHealthScore >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
              overallHealthScore >= 60 ? "bg-amber-50 text-amber-700 border-amber-200" :
              "bg-rose-50 text-rose-700 border-rose-200"
            )}>
              {overallHealthScore !== null ? `${overallHealthScore}/100` : 'Unknown'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {[
            {
              name: 'Availability Score',
              score: health.availabilityScore ?? null,
              coverage: componentEvidence('Availability'),
              metric: 'Reachability & Uptime',
              status: health.availabilityScore == null ? 'Unknown' : componentEvidence('Availability') < 100 ? 'Partial' : health.availabilityScore >= 80 ? 'Healthy' : health.availabilityScore >= 60 ? 'Warning' : 'Critical',
            },
            {
              name: 'Network Performance',
              score: health.performanceScore ?? null,
              coverage: componentEvidence('Network Performance'),
              metric: `RTT ${latestMetric.latency ?? '—'}ms · Loss ${latestMetric.packetLoss ?? '—'}%`,
              status: health.performanceScore == null ? 'Excluded' : componentEvidence('Network Performance') < 100 ? 'Partial' : health.performanceScore >= 80 ? 'Healthy' : health.performanceScore >= 60 ? 'Warning' : 'Critical',
            },
            {
              name: 'Traffic Health',
              score: health.trafficScore ?? null,
              coverage: componentEvidence('Traffic Health'),
              metric: latestMetric.incomingThroughputBps !== null ? formatBitRate(latestMetric.incomingThroughputBps) : 'SNMP IF-MIB needed',
              status: health.trafficScore == null ? 'Excluded' : componentEvidence('Traffic Health') < 100 ? 'Partial' : health.trafficScore >= 80 ? 'Healthy' : 'Warning',
            },
            {
              name: 'Hardware Health',
              score: health.hardwareScore ?? null,
              coverage: componentEvidence('Hardware Health'),
              metric: latestMetric.cpuUtilization !== null ? `CPU: ${latestMetric.cpuUtilization}% · RAM: ${latestMetric.memoryUtilization ?? '—'}%` : 'SNMP OIDs needed',
              status: health.hardwareScore == null ? 'Excluded' : componentEvidence('Hardware Health') < 100 ? 'Partial' : health.hardwareScore >= 80 ? 'Healthy' : 'Warning',
            },
          ].map((comp) => (
            <div key={comp.name} className="rounded-xl bg-slate-50/80 p-3.5 border border-slate-200/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">{comp.name}</span>
                <span className="font-mono text-sm font-bold text-slate-900">
                  {comp.score !== null ? `${Math.round(comp.score)}%` : '—'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">{comp.metric}</p>
              {comp.coverage !== undefined && (
                <p className="mt-1 text-[10px] text-slate-500">Evidence coverage: {comp.coverage}%</p>
              )}
              <div className="mt-2.5 flex items-center justify-between text-[10px]">
                <span className="text-slate-400 uppercase font-semibold">Status</span>
                <span className={clsx(
                  "font-bold uppercase px-1.5 py-0.2 rounded",
                  comp.status === 'Healthy' ? "text-emerald-700 bg-emerald-50" :
                  comp.status === 'Critical' ? "text-rose-700 bg-rose-50" :
                  comp.status === 'Degraded' || comp.status === 'Warning' || comp.status === 'Partial' ? "text-amber-700 bg-amber-50" :
                  "text-slate-500 bg-slate-200"
                )}>
                  {comp.status}
                </span>
              </div>
            </div>
          ))}
        </div>
        {health.coveragePercent !== null && health.coveragePercent !== undefined && (
          <p className="text-xs text-slate-600">
            Evidence coverage: {health.coveragePercent}%.
            {health.explanation ? ` ${health.explanation}.` : ' Missing components remain unavailable and limit the maximum overall score.'}
          </p>
        )}
        {overallHealthScore === null && (
          <p className="text-xs text-slate-600">
            Health status: {healthStatus}. {health.explanation || 'No verified measurements are available to calculate an overall health score.'}
          </p>
        )}
      </section>

      {/* Network Metrics Overview Strip */}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass-card-static rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Latency Average</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl sm:text-3xl font-extrabold text-slate-900">
              {latestMetric.latency == null ? 'Not collected' : `${latestMetric.latency}`}
            </span>
            {latestMetric.latency != null && <span className="text-xs font-semibold text-slate-500">ms</span>}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {latestMetric.latency == null ? reasonForMetric('rtt', 'No successful ICMP round-trip sample') : `Min: ${latestMetric.rttMin ?? '—'} · Max: ${latestMetric.rttMax ?? '—'} ms`}
          </p>
        </div>

        <div className="glass-card-static rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Packet Loss Rate</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl sm:text-3xl font-extrabold text-slate-900">
              {latestMetric.packetLoss == null ? 'Not collected' : `${latestMetric.packetLoss}`}
            </span>
            {latestMetric.packetLoss != null && <span className="text-xs font-semibold text-slate-500">%</span>}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {latestMetric.packetLoss == null ? reasonForMetric('packetLoss', 'No valid packet-loss measurement') : `Availability: ${latestMetric.availability ?? '—'}%`}
          </p>
        </div>

        <div className="glass-card-static rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Inbound Throughput</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-xl sm:text-2xl font-extrabold text-slate-900 truncate">
              {formatBitRate(latestMetric.incomingThroughputBps)}
            </span>
          </div>
          <p className="mt-2 break-words text-xs text-slate-500">
            Source: {latestMetric.source || 'No interface collector'} · {latestMetric.interfaceId || 'Interface not configured'}
            {latestMetric.incomingThroughputBps == null ? ` — ${reasonForMetric('inboundThroughput', 'Waiting for two interface counter samples')}` : ''}
          </p>
        </div>

        <div className="glass-card-static rounded-2xl border border-slate-200 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Outbound Throughput</p>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-xl sm:text-2xl font-extrabold text-slate-900 truncate">
              {formatBitRate(latestMetric.outgoingThroughputBps)}
            </span>
          </div>
          <p className="mt-2 break-words text-xs text-slate-500">
            Source: {latestMetric.source || 'No interface collector'}
            {latestMetric.outgoingThroughputBps == null ? ` — ${reasonForMetric('outboundThroughput', 'Waiting for two interface counter samples')}` : ' · Rate from byte-counter deltas'}
          </p>
        </div>
      </div>

      {/* Hardware telemetry section */}
      <section className="glass-card-static rounded-2xl border border-slate-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-sky-600" />
              Hardware Telemetry (SNMP MIBs)
            </h2>
            <p className="text-xs text-slate-500">
              Values are shown only when collected; simulated values and unsupported collectors are identified.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500">
            Source: {latestMetric.measurementSource === 'simulated' ? 'Simulation' : latestMetric.snmp?.responded ? 'SNMP Agent' : 'No agent telemetry'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* CPU Card */}
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">CPU Utilization</span>
              <Cpu className="w-4 h-4 text-sky-600" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-2xl font-extrabold text-slate-900">
                {latestMetric.cpuUtilization != null ? `${latestMetric.cpuUtilization}%` : 'Not collected'}
              </span>
            </div>
            {latestMetric.cpuUtilization != null && (
              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div 
                  className={clsx(
                    "h-full rounded-full transition-all",
                    latestMetric.cpuUtilization > 85 ? "bg-rose-500" :
                    latestMetric.cpuUtilization > 70 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${Math.min(100, latestMetric.cpuUtilization)}%` }}
                />
              </div>
            )}
            <p className="text-[10px] text-slate-500">
              {hardware.cpu?.reason || (latestMetric.cpuUtilization !== null ? `Collected via ${hardware.cpu?.source || 'SNMP'}` : 'Requires supported CPU OID')}
            </p>
          </div>

          {/* Memory Card */}
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Memory Utilization</span>
              <HardDrive className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-2xl font-extrabold text-slate-900">
                {latestMetric.memoryUtilization != null ? `${latestMetric.memoryUtilization}%` : 'Not collected'}
              </span>
            </div>
            {latestMetric.memoryUtilization != null && (
              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div 
                  className={clsx(
                    "h-full rounded-full transition-all",
                    latestMetric.memoryUtilization > 85 ? "bg-rose-500" :
                    latestMetric.memoryUtilization > 75 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${Math.min(100, latestMetric.memoryUtilization)}%` }}
                />
              </div>
            )}
            <p className="text-[10px] text-slate-500">
              {hardware.memory?.totalBytes ? `Total: ${formatBytes(hardware.memory.totalBytes)}` : (hardware.memory?.reason || 'Requires supported memory OID')}
            </p>
          </div>

          {/* Temperature Card */}
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Device Temperature</span>
              <Thermometer className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-2xl font-extrabold text-slate-900">
                {hardware.temperature?.celsius !== null && hardware.temperature?.celsius !== undefined 
                  ? `${hardware.temperature.celsius}°C` 
                  : 'Not collected'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500">
              {hardware.temperature?.thresholdCelsius 
                ? `Threshold: ${hardware.temperature.thresholdCelsius}°C` 
                : (hardware.temperature?.reason || 'Requires environmental sensor OID')}
            </p>
          </div>

          {/* System Uptime Card */}
          <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">System Uptime</span>
              <Activity className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="flex items-baseline gap-1">
              <span className="font-mono text-xl font-extrabold text-slate-900">
                {latestDerived.deviceUptimeSeconds != null 
                  ? `${(latestDerived.deviceUptimeSeconds / 3600).toFixed(1)} hrs` 
                  : 'Not collected'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500">
              Source: {hardware.system?.sysUpTime != null
                ? 'SNMPv2-MIB sysUpTime.0'
                : latestMetric.measurementSource === 'simulated'
                  ? 'SNMPv2-MIB sysUpTime.0 (not queried in simulation)'
                  : 'SNMPv2-MIB sysUpTime.0 (not returned)'}
            </p>
          </div>
        </div>
      </section>

      {/* Interface and Uptime Telemetry */}
      <section className="glass-card-static rounded-2xl border border-slate-200 p-5">
        <h2 className="text-base font-bold text-slate-900">Extended Interface Telemetry</h2>
        <p className="mt-1 text-xs text-slate-500">Source: SNMP IF-MIB (or local host-interface RX/TX counters). Includes throughput, interface speed/status, and error counters.</p>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Inbound throughput', formatBitRate(latestMetric.incomingThroughputBps)],
            ['Outbound throughput', formatBitRate(latestMetric.outgoingThroughputBps)],
            ['Device uptime', latestDerived.deviceUptimeSeconds == null ? (hardware.system?.sysUpTime == null ? 'Not collected — SNMP system group did not respond' : 'Not calculated') : `${(latestDerived.deviceUptimeSeconds / 3600).toFixed(1)} hours`],
            ['Interface Index', latestMetric.snmp?.ifIndex || 'Not configured', null],
            ['Interface speed', latestMetric.snmp?.interfaceSpeed == null ? 'Not reported' : formatBitRate(latestMetric.snmp.interfaceSpeed), reasonForMetric('interface_speed', 'IF-MIB ifSpeed/ifHighSpeed was not returned')],
            ['Operational status', formatInterfaceStatus(latestMetric.snmp?.operationalStatus), reasonForMetric('interface_operational_status', 'IF-MIB ifOperStatus was not returned')],
            ['Inbound errors', latestDerived.inboundInterfaceErrors ?? 'Not collected', reasonForMetric('inbound_interface_errors', 'Counter not returned by the interface')],
            ['Outbound errors', latestDerived.outboundInterfaceErrors ?? 'Not collected', reasonForMetric('outbound_interface_errors', 'Counter not returned by the interface')],
            ['Inbound discards', latestDerived.inboundDroppedPackets ?? 'Not collected', reasonForMetric('inbound_dropped_packets', 'Counter not returned by the interface')],
            ['Outbound discards', latestDerived.outboundDroppedPackets ?? 'Not collected', reasonForMetric('outbound_dropped_packets', 'Counter not returned by the interface')],
            ['Inbound utilization', latestDerived.inboundInterfaceUtilizationPercent == null ? 'Not calculated' : `${latestDerived.inboundInterfaceUtilizationPercent.toFixed(2)}%`, reasonForMetric('inboundThroughput', 'Requires measured throughput and reported interface speed')],
            ['Outbound utilization', latestDerived.outboundInterfaceUtilizationPercent == null ? 'Not calculated' : `${latestDerived.outboundInterfaceUtilizationPercent.toFixed(2)}%`, reasonForMetric('outboundThroughput', 'Requires measured throughput and reported interface speed')],
          ].map(([label, value, reason]) => (
            <div key={label} className="rounded-xl bg-slate-50 p-3">
              <p className="break-words text-[10px] font-semibold uppercase text-slate-400">{label}</p>
              <p className="mt-1 break-words font-mono text-xs font-bold text-slate-800">{value}</p>
              {reason && value !== 'Not configured' && value !== 'Not calculated' && (
                <p className="mt-1 break-words text-[10px] text-slate-500">{reason}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Latency History Chart & Node Specifications */}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-2">
        
        {/* Latency History Chart */}
        <div className="glass-card-static min-w-0 rounded-2xl p-6 border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Round-Trip Latency History</h2>
              <p className="text-xs text-slate-500">ICMP RTT trend; simulation data is identified in the collection banner</p>
            </div>
            <select
              value={range}
              onChange={(event) => setRange(event.target.value)}
              className="text-xs font-mono font-bold text-sky-700 px-2 py-1 rounded bg-sky-50 border border-sky-200 cursor-pointer"
              aria-label="Telemetry history range"
            >
              <option value="1h">1 hour</option>
              <option value="6h">6 hours</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </div>

          <div className="h-72 min-w-0 w-full">
            {chartData.some(point => point.latency !== null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorLatDev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
                      <stop offset="90%" stopColor="#0284c7" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} minTickGap={32} interval="preserveStartEnd" />
                  <YAxis dataKey="latency" width={55} stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v}ms`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                  />
                  <Area type="monotone" dataKey="latency" connectNulls={false} stroke="#0284c7" strokeWidth={2.5} fillOpacity={1} fill="url(#colorLatDev)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                No latency observations recorded in this time range.
              </div>
            )}
          </div>
        </div>

        {/* Node Specifications & Identity Card */}
        <div className="glass-card-static min-w-0 rounded-2xl p-6 border border-slate-200 flex flex-col justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 mb-1">Node Specifications & Identity</h2>
            <p className="text-xs text-slate-500 mb-5">Hardware profile, protocol, and network identity</p>

            <div className="space-y-3.5 text-xs">
              <div className="flex min-w-0 items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
                <span className="text-slate-500">Node Architecture</span>
                <span className="min-w-0 break-words text-right text-slate-900 font-bold capitalize flex items-center gap-1.5">
                  {getDeviceIcon(device.type)}
                  {device.type}
                </span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
                <span className="text-slate-500">MAC Address</span>
                <span className="min-w-0 break-words text-right text-slate-900 font-mono font-bold">
                  {device.macAddress || 'Not recorded'}
                </span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
                <span className="text-slate-500">Hardware Vendor</span>
                <span className="min-w-0 break-words text-right text-blue-700 font-semibold">
                  {device.vendor || 'Unknown'}
                </span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
                <span className="text-slate-500">Operating System</span>
                <span className="min-w-0 break-words text-right text-slate-800 font-medium truncate max-w-xs" title={device.operatingSystem}>
                  {device.operatingSystem || 'Unknown'}
                </span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
                <span className="text-slate-500">Monitoring Protocol</span>
                <span className="min-w-0 break-words text-right text-sky-700 font-mono font-bold uppercase">{device.monitoringMethod || 'ICMP Ping'}</span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
                <span className="text-slate-500">SNMP Configuration</span>
                <span className="min-w-0 break-words text-right text-slate-800 font-mono font-semibold">
                  {device.snmpVersion ? `v${device.snmpVersion} (Protected)` : 'None'}
                </span>
              </div>

              <div className="flex min-w-0 items-center justify-between gap-3">
                <span className="text-slate-500">Last Seen</span>
                <span className="min-w-0 break-words text-right text-slate-800 font-mono">
                  {device.lastSeen ? formatTimestamp(device.lastSeen) : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Metric Coverage Table */}
      {metricCoverage && (
        <section className="glass-card-static overflow-hidden rounded-2xl border border-slate-200">
          <div className="border-b border-slate-100 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900">Collector Metric Coverage</h2>
              <span className="font-mono text-lg font-bold text-sky-700">{metricCoverage.summary.coveragePercent}%</span>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {metricCoverage.summary.successfullyCollectedMetrics} of {metricCoverage.summary.totalSupportedMetrics} supported metrics currently have fresh observations. Missing metrics remain null without being replaced by zero.
            </p>
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Metric</th>
                  <th className="px-4 py-2">Value</th>
                  <th className="px-4 py-2">Source / Status</th>
                  <th className="px-4 py-2">Last Collected / Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {metricCoverage.metrics.map(metric => (
                  <tr key={metric.id}>
                    <td className="px-4 py-2 font-semibold text-slate-700">{metric.name}</td>
                    <td className="px-4 py-2 font-mono text-slate-800">
                      {metric.value === null ? '—' : `${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`}
                    </td>
                    <td className="px-4 py-2">
                      <span className={clsx(
                        "font-semibold uppercase text-[10px] px-1.5 py-0.2 rounded",
                        metric.status === 'AVAILABLE' ? "bg-emerald-50 text-emerald-700" :
                        metric.status === 'STALE' ? "bg-amber-50 text-amber-700" :
                        "bg-slate-100 text-slate-500"
                      )}>{metric.status}</span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">{metric.source}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-500 text-[11px]">
                      {metric.reason || (metric.freshnessSeconds != null ? `${metric.freshnessSeconds}s ago` : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Incident & Alert History */}
      <section className="glass-card-static w-full min-w-0 rounded-2xl border border-slate-200 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Alert and Incident History</h2>
            <p className="text-xs text-slate-500">Recorded hardware, availability, and performance events</p>
          </div>
          <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700">
            {alerts.filter(alert => alert.status !== 'RESOLVED').length} active
          </span>
        </div>
        {alerts.length === 0 ? (
          <p className="mt-4 text-xs text-slate-500">No active or historical incidents recorded for this device.</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-100">
            {alerts.map(alert => (
              <div key={alert._id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xs font-semibold text-slate-800">{alert.message}</p>
                  <p className="text-[10px] text-slate-500">
                    First occurred: {format(new Date(alert.firstOccurredAt || alert.createdAt), 'MMM d, HH:mm:ss')}
                    {alert.occurrenceCount > 1 ? ` · ${alert.occurrenceCount} occurrences` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[10px] font-bold uppercase">
                  <span className={clsx(
                    "px-2 py-0.5 rounded",
                    alert.severity === 'CRITICAL' ? "bg-rose-100 text-rose-700" :
                    alert.severity === 'HIGH' ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-700"
                  )}>{alert.severity}</span>
                  <span className={clsx(
                    "px-2 py-0.5 rounded border",
                    alert.status === 'RESOLVED' ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-amber-700 bg-amber-50 border-amber-200"
                  )}>{alert.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

    </div>
  );
};

export default DeviceDetails;
