import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { 
  Activity, 
  Server, 
  AlertCircle, 
  CheckCircle, 
  Clock, 
  ArrowUpRight, 
  ArrowDownRight,
  ShieldCheck, 
  Router, 
  Wifi, 
  ChevronRight, 
  Zap,
  Cpu,
  Layers,
  Radio,
  Globe,
  AlertTriangle,
  RefreshCw,
  Search,
  Check
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const MetricCard = ({ title, value, unit, icon: Icon, colorTheme, subtitle, trend, trendGood }) => {
  const themes = {
    cyan: {
      border: 'border-slate-200 hover:border-sky-300',
      iconBg: 'bg-sky-50 text-sky-600 border border-sky-200/80',
      bar: 'bg-gradient-to-r from-sky-500 to-blue-600',
      badge: 'bg-sky-50 text-sky-700 border-sky-200',
    },
    emerald: {
      border: 'border-slate-200 hover:border-emerald-300',
      iconBg: 'bg-emerald-50 text-emerald-600 border border-emerald-200/80',
      bar: 'bg-gradient-to-r from-emerald-500 to-teal-500',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    amber: {
      border: 'border-slate-200 hover:border-amber-300',
      iconBg: 'bg-amber-50 text-amber-600 border border-amber-200/80',
      bar: 'bg-gradient-to-r from-amber-500 to-orange-500',
      badge: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    rose: {
      border: 'border-slate-200 hover:border-rose-300',
      iconBg: 'bg-rose-50 text-rose-600 border border-rose-200/80',
      bar: 'bg-gradient-to-r from-rose-500 to-red-600',
      badge: 'bg-rose-50 text-rose-700 border-rose-200',
    },
    violet: {
      border: 'border-slate-200 hover:border-violet-300',
      iconBg: 'bg-violet-50 text-violet-600 border border-violet-200/80',
      bar: 'bg-gradient-to-r from-violet-500 to-purple-600',
      badge: 'bg-violet-50 text-violet-700 border-violet-200',
    }
  };

  const currentTheme = themes[colorTheme] || themes.cyan;

  return (
    <div className={clsx(
      "glass-card rounded-2xl p-6 relative overflow-hidden flex flex-col justify-between transition-all duration-300 group",
      currentTheme.border
    )}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-mono">{value}</span>
            {unit && <span className="text-sm font-semibold text-slate-500 font-sans">{unit}</span>}
          </div>
        </div>
        <div className={clsx("p-3 rounded-xl transition-transform duration-300 group-hover:scale-110", currentTheme.iconBg)}>
          <Icon className="w-6 h-6" />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs pt-3 border-t border-slate-100 mt-2">
        <span className="text-slate-500 font-medium">{subtitle}</span>
        {trend && (
          <span className={clsx("px-2 py-0.5 rounded-full border text-[11px] font-bold flex items-center gap-1", currentTheme.badge)}>
            {trendGood ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {trend}
          </span>
        )}
      </div>

      <div className={clsx("absolute bottom-0 left-0 right-0 h-1", currentTheme.bar)} />
    </div>
  );
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white border border-slate-200 p-3 rounded-xl shadow-xl text-xs space-y-1">
        <p className="text-slate-500 font-mono font-medium">{label}</p>
        <p className="text-sky-600 font-bold font-mono text-sm flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-sky-600" />
          Latency: {payload[0].value} ms
        </p>
        <p className="text-slate-500">Source: {payload[0].payload.measurementSource}</p>
      </div>
    );
  }
  return null;
};

const Dashboard = () => {
  const [summary, setSummary] = useState(null);
  const [metricCoverage, setMetricCoverage] = useState(null);
  const [devices, setDevices] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [discoveryJobs, setDiscoveryJobs] = useState([]);
  const [latencyData, setLatencyData] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('1h');

  const fetchMetricCoverage = useCallback(async () => {
    try {
      const { data } = await api.get('/metrics/coverage');
      setMetricCoverage(data);
    } catch (error) {
      console.error('Error fetching metric coverage:', error);
    }
  }, []);

  const fetchDashboardData = useCallback(async () => {
    try {
      const [summaryRes, devicesRes, alertsRes] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/devices'),
        api.get('/alerts')
      ]);
      setSummary(summaryRes.data);
      setDevices(devicesRes.data);
      setAlerts(alertsRes.data.slice(0, 8));

      // Optional discovery jobs for NOC activity view
      try {
        const jobsRes = await api.get('/devices/discovery/jobs');
        setDiscoveryJobs(jobsRes.data || []);
      } catch {
        // Discovery jobs query may be admin-only or empty
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
    const refreshTimer = setInterval(fetchDashboardData, 15_000);

    const socket = getSocket();
    const handleDeviceUpdated = (device) => {
      setDevices(prev => prev.map(d => d._id === device._id ? device : d));
      fetchDashboardData();
    };
    const handleNewAlert = (alert) => {
      setAlerts(prev => [alert, ...prev].slice(0, 8));
    };
    const handleMetricAdded = (metric) => {
      fetchMetricCoverage();
      if (metric.latency === null || metric.latency === undefined) return;
      const createdAt = new Date(metric.createdAt);
      if (Number.isNaN(createdAt.getTime())) return;
      const rangeMs = {
        '1h': 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
      }[timeRange];
      if (createdAt.getTime() < Date.now() - rangeMs) return;
      setLatencyData(prev => [
        ...prev.filter(point => point.createdAt !== metric.createdAt),
        {
          time: format(createdAt, 'MMM d HH:mm'),
          createdAt: metric.createdAt,
          latency: metric.latency,
          measurementSource: metric.measurementSource || 'unknown',
        },
      ].slice(-24));
    };
    if (socket) {
      socket.on('deviceUpdated', handleDeviceUpdated);
      socket.on('newAlert', handleNewAlert);
      socket.on('metricAdded', handleMetricAdded);
    }

    return () => {
      if (socket) {
        socket.off('deviceUpdated', handleDeviceUpdated);
        socket.off('newAlert', handleNewAlert);
        socket.off('metricAdded', handleMetricAdded);
      }
      clearInterval(refreshTimer);
    };
  }, [fetchDashboardData, fetchMetricCoverage, timeRange]);

  useEffect(() => {
    fetchMetricCoverage();
    const timer = setInterval(fetchMetricCoverage, 30_000);
    return () => clearInterval(timer);
  }, [fetchMetricCoverage]);

  useEffect(() => {
    let active = true;
    api.get(`/analytics/performance?range=${timeRange}`)
      .then(({ data }) => {
        if (!active) return;
        const points = data
          .filter(metric => metric.latency !== null && metric.latency !== undefined)
          .slice(-24)
          .map(metric => ({
            time: format(new Date(metric.createdAt), 'MMM d HH:mm'),
            createdAt: metric.createdAt,
            latency: metric.latency,
            measurementSource: metric.measurementSource || 'unknown',
          }));
        setLatencyData(points);
      })
      .catch(error => {
        console.error('Error fetching latency history:', error);
        if (active) setLatencyData([]);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });

    return () => {
      active = false;
    };
  }, [timeRange]);

  // Health Score Distribution across fleet
  const healthDistribution = useMemo(() => {
    const dist = { healthy: 0, warning: 0, critical: 0, unknown: 0 };
    devices.forEach(d => {
      const status = d.healthStatus || 'UNKNOWN';
      if (status === 'HEALTHY') dist.healthy++;
      else if (status === 'WARNING') dist.warning++;
      else if (status === 'CRITICAL') dist.critical++;
      else dist.unknown++;
    });
    return dist;
  }, [devices]);

  // Reachability Methods Breakdown across fleet
  const reachabilityBreakdown = useMemo(() => {
    const counts = { ICMP: 0, TCP: 0, SNMP: 0, NEIGHBOUR: 0, OTHER: 0 };
    devices.forEach(d => {
      const method = (d.reachabilityMethod || '').toUpperCase();
      if (method.includes('ICMP')) counts.ICMP++;
      else if (method.includes('TCP')) counts.TCP++;
      else if (method.includes('SNMP')) counts.SNMP++;
      else if (method.includes('NEIGHBOUR') || method.includes('ARP')) counts.NEIGHBOUR++;
      else counts.OTHER++;
    });
    return counts;
  }, [devices]);

  // Devices requiring NOC attention (Down, Warning, Critical)
  const attentionDevices = useMemo(() => {
    return devices.filter(d => 
      d.status === 'DOWN' || 
      d.healthStatus === 'CRITICAL' || 
      d.healthStatus === 'WARNING'
    ).slice(0, 5);
  }, [devices]);

  // Active discovery jobs
  const activeJobsCount = useMemo(() => {
    return discoveryJobs.filter(j => j.status === 'RUNNING').length;
  }, [discoveryJobs]);

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
          <Zap className="w-5 h-5 text-sky-600 absolute inset-0 m-auto" />
        </div>
        <p className="text-slate-500 text-sm font-medium tracking-wide">Connecting to NOC Telemetry Stream...</p>
      </div>
    );
  }

  const isSimulated = summary.measurementSource?.toLowerCase().includes('simulat');
  const hasRecentRealTelemetry = !isSimulated && summary.hasRecentRealTelemetry === true;
  const hasHealthInputs = summary.avgPacketLoss !== null && summary.avgLatency !== null;
  const healthScore = hasHealthInputs ? Math.max(0, Math.min(100, Math.round(
    100 - (summary.offlineDevices * 10) - (summary.avgPacketLoss * 2) - (summary.avgLatency > 80 ? 15 : 0)
  ))) : null;
  const healthGrade = healthScore === null ? 'NO DATA' : healthScore >= 90 ? 'OPTIMAL' : healthScore >= 75 ? 'DEGRADED' : 'CRITICAL';
  const healthColor = healthScore === null ? '#94a3b8' : healthScore >= 90 ? '#059669' : healthScore >= 75 ? '#d97706' : '#e11d48';

  return (
    <div className="space-y-8 pb-12">
      
      {/* Simulation / Real Source Status Banner */}
      {isSimulated ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <div>
              <p className="font-bold text-amber-900 uppercase tracking-wide text-[11px]">Simulation Mode Active</p>
              <p className="text-amber-800 text-xs mt-0.5">
                Displaying demonstration telemetry. Hardware collectors for real network interfaces, CPU, and RAM execute automatically when connected to campus subnets.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-amber-200/80 text-amber-900 text-[10px] font-mono font-bold tracking-wider shrink-0 uppercase border border-amber-300">
            SYNTHETIC
          </span>
        </div>
      ) : hasRecentRealTelemetry ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
              <Check className="w-4 h-4" />
            </span>
            <div>
              <p className="font-bold text-emerald-900 uppercase tracking-wide text-[11px]">Real Telemetry Stream Active</p>
              <p className="text-emerald-800 text-xs mt-0.5">
                Source: <span className="font-mono font-bold uppercase">{summary.measurementSource}</span>. Real-time multi-method reachability, hardware counters, and interface telemetry.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-emerald-200/80 text-emerald-900 text-[10px] font-mono font-bold tracking-wider shrink-0 uppercase border border-emerald-300">
            HARDWARE
          </span>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <div>
              <p className="font-bold text-amber-900 uppercase tracking-wide text-[11px]">No Recent Real Telemetry</p>
              <p className="text-amber-800 text-xs mt-0.5">
                No valid real measurement has been recorded in the last 60 seconds.
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-amber-200/80 text-amber-900 text-[10px] font-mono font-bold tracking-wider shrink-0 uppercase border border-amber-300">
            NO DATA
          </span>
        </div>
      )}

      {/* KPI Cards Row (5 Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <MetricCard
          title="Monitored Fleet"
          value={summary.totalDevices}
          unit="Nodes"
          subtitle={`${summary.monitoringDevices} with polling active`}
          icon={Server}
          colorTheme="cyan"
          trend={`${Math.round((summary.monitoringDevices / Math.max(1, summary.totalDevices)) * 100)}% active`}
          trendGood={summary.monitoringDevices === summary.totalDevices}
        />
        <MetricCard
          title="Nodes Reachable"
          value={summary.reachableDevices}
          unit={`/ ${summary.totalDevices}`}
          subtitle={`${summary.offlineDevices} offline, ${summary.unknownDevices} unknown`}
          icon={CheckCircle}
          colorTheme="emerald"
          trend={`${Math.round((summary.reachableDevices / Math.max(1, summary.totalDevices)) * 100)}% UP`}
          trendGood={summary.offlineDevices === 0}
        />
        <MetricCard
          title="Mean Latency"
          value={summary.avgLatency ?? 'Unavailable'}
          unit={summary.avgLatency === null ? '' : 'ms'}
          subtitle="Mean round-trip time"
          icon={Activity}
          colorTheme="amber"
          trend={summary.avgLatency === null ? 'No sample' : summary.avgLatency < 50 ? 'Optimal' : 'Elevated'}
          trendGood={summary.avgLatency !== null && summary.avgLatency < 50}
        />
        <MetricCard
          title="Packet Loss"
          value={summary.avgPacketLoss ?? 'Unavailable'}
          unit={summary.avgPacketLoss === null ? '' : '%'}
          subtitle="Mean over valid observations"
          icon={AlertCircle}
          colorTheme={summary.avgPacketLoss !== null && summary.avgPacketLoss > 2 ? 'rose' : 'emerald'}
          trend={summary.avgPacketLoss === null ? 'No sample' : summary.avgPacketLoss === 0 ? '0% loss' : 'Loss seen'}
          trendGood={summary.avgPacketLoss !== null && summary.avgPacketLoss === 0}
        />
        <MetricCard
          title="Fleet Hardware"
          value={summary.avgCpu !== null && summary.avgCpu !== undefined ? `${summary.avgCpu}%` : 'N/A'}
          unit={summary.avgCpu !== null && summary.avgCpu !== undefined ? 'CPU' : ''}
          subtitle={summary.avgMemory !== null && summary.avgMemory !== undefined ? `${summary.avgMemory}% RAM utilization` : 'SNMP hardware telemetry'}
          icon={Cpu}
          colorTheme="violet"
          trend={activeJobsCount > 0 ? `${activeJobsCount} discovery job` : 'SNMP monitored'}
          trendGood={summary.avgCpu !== null && summary.avgCpu < 75}
        />
      </div>

      {/* Metric Coverage Summary */}
      {metricCoverage && (
        <section className="glass-card-static rounded-2xl border border-slate-200 p-5" aria-label="Metric coverage summary">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-600" />
              Monitoring Coverage & Freshness
            </h2>
            <span className="font-mono text-lg font-bold text-sky-700">{metricCoverage.coveragePercent}%</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Based on collected values for metrics supported by each enrolled device. Unsupported metrics are excluded from coverage.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
            <div><p className="text-slate-500">Supported</p><p className="font-mono font-bold text-slate-800">{metricCoverage.totalSupportedMetrics}</p></div>
            <div><p className="text-slate-500">Collected</p><p className="font-mono font-bold text-emerald-700">{metricCoverage.successfullyCollectedMetrics}</p></div>
            <div><p className="text-slate-500">Unavailable</p><p className="font-mono font-bold text-amber-700">{metricCoverage.unavailableMetrics}</p></div>
            <div><p className="text-slate-500">Stale</p><p className="font-mono font-bold text-orange-700">{metricCoverage.staleMetrics}</p></div>
            <div><p className="text-slate-500">Errors</p><p className="font-mono font-bold text-rose-700">{metricCoverage.errorMetrics}</p></div>
          </div>
        </section>
      )}

      {/* Observability Hub: Health Gauge + Fleet Health Distribution + Reachability Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Network Health Index Gauge */}
        <div className="glass-card-static rounded-2xl p-6 lg:col-span-4 flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-sky-600" />
                Network Health Index
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Campus aggregate health index</p>
            </div>
            <span className={clsx(
              "px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase rounded-full border",
              healthScore === null ? "bg-slate-50 text-slate-600 border-slate-200" :
              healthScore >= 90 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
              healthScore >= 75 ? "bg-amber-50 text-amber-800 border-amber-200" :
              "bg-rose-50 text-rose-700 border-rose-200"
            )}>
              {healthGrade}
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Formula: 100 − 10 × offline devices − 2 × average packet loss − 15 when latency exceeds 80 ms, clamped to 0–100.
          </p>

          {/* Donut Gauge */}
          <div className="relative w-44 h-44 mx-auto my-3 flex items-center justify-center">
            {healthScore !== null && (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={[{ value: healthScore }, { value: 100 - healthScore }]}
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={78}
                    startAngle={90}
                    endAngle={-270}
                    dataKey="value"
                    stroke="none"
                  >
                    <Cell fill={healthColor} />
                    <Cell fill="#f1f5f9" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            )}
            
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-black text-slate-900 font-mono tracking-tight">{healthScore ?? 'N/A'}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">SCORE / 100</span>
            </div>
          </div>

          <div className="space-y-2 pt-3 border-t border-slate-100 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Reachable Nodes</span>
              <span className="text-slate-700 font-mono font-bold">{summary.reachableDevices} / {summary.totalDevices}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-500 font-medium">Active Discovery Jobs</span>
              <span className="text-sky-700 font-mono font-bold">{activeJobsCount} running</span>
            </div>
          </div>
        </div>

        {/* Fleet Device Health Distribution & Multi-Method Reachability */}
        <div className="glass-card-static rounded-2xl p-6 lg:col-span-8 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-sky-600" />
                  Fleet Health & Reachability Distribution
                </h2>
                <p className="text-xs text-slate-500">Multi-factor health scoring and multi-method reachability</p>
              </div>
              <span className="text-xs font-mono font-bold text-slate-500">{devices.length} Total Enrolled</span>
            </div>

            {/* Health Score Tier Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Healthy (≥80)</span>
                <p className="text-2xl font-black font-mono text-emerald-800 mt-1">{healthDistribution.healthy}</p>
                <p className="text-[10px] text-emerald-600 font-medium">Nominal metrics</p>
              </div>
              <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Warning (60-79)</span>
                <p className="text-2xl font-black font-mono text-amber-800 mt-1">{healthDistribution.warning}</p>
                <p className="text-[10px] text-amber-600 font-medium">Degraded state</p>
              </div>
              <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/50">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700">Critical (&lt;60)</span>
                <p className="text-2xl font-black font-mono text-rose-800 mt-1">{healthDistribution.critical}</p>
                <p className="text-[10px] text-rose-600 font-medium">Needs attention</p>
              </div>
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unknown / Pending</span>
                <p className="text-2xl font-black font-mono text-slate-700 mt-1">{healthDistribution.unknown}</p>
                <p className="text-[10px] text-slate-500 font-medium">No valid telemetry</p>
              </div>
            </div>

            {/* Multi-Method Reachability Breakdown */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-sky-600" />
                  Reachability Verification Breakdown
                </span>
                <span className="text-[11px] text-slate-500">ICMP-blocked nodes verified via TCP/SNMP/Neighbour</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="p-2.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between">
                  <span className="text-slate-500 font-medium">ICMP Echo</span>
                  <span className="font-mono font-bold text-slate-800">{reachabilityBreakdown.ICMP}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between">
                  <span className="text-slate-500 font-medium">TCP Service</span>
                  <span className="font-mono font-bold text-sky-700">{reachabilityBreakdown.TCP}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between">
                  <span className="text-slate-500 font-medium">SNMP Poll</span>
                  <span className="font-mono font-bold text-indigo-700">{reachabilityBreakdown.SNMP}</span>
                </div>
                <div className="p-2.5 rounded-lg border border-slate-200 bg-white flex items-center justify-between">
                  <span className="text-slate-500 font-medium">Neighbour Table</span>
                  <span className="font-mono font-bold text-purple-700">{reachabilityBreakdown.NEIGHBOUR}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>Overall Availability: <strong className="text-slate-800 font-mono">{summary.totalDevices > 0 ? Math.round((summary.reachableDevices / summary.totalDevices) * 100) : 0}%</strong></span>
            <Link to="/devices" className="text-sky-600 hover:text-sky-700 font-bold flex items-center gap-1">
              Configure Polling Schedules <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

      </div>

      {/* Latency Stream Chart */}
      <div className="glass-card-static rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-600"></span>
              </span>
              <h2 className="text-base font-bold text-slate-900">Network Latency Observation Trend</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">Continuous round-trip measurements; hover point to inspect telemetry source</p>
          </div>

          <div className="flex items-center p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto">
            {['1h', '6h', '24h', '7d'].map(r => (
              <button
                key={r}
                onClick={() => {
                  if (timeRange !== r) {
                    setHistoryLoading(true);
                    setTimeRange(r);
                  }
                }}
                className={clsx(
                  "px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer",
                  timeRange === r
                    ? "bg-white text-sky-700 shadow-xs border border-slate-200/80"
                    : "text-slate-500 hover:text-slate-900"
                )}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="h-64 w-full">
          {!historyLoading && latencyData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">No latency observations recorded in this time range.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="latencyGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
                    <stop offset="90%" stopColor="#0284c7" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  stroke="#94a3b8" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                  dy={8}
                />
                <YAxis 
                  stroke="#94a3b8" 
                  fontSize={11} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={(v) => `${v}ms`} 
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="latency" 
                  connectNulls={false}
                  stroke="#0284c7" 
                  strokeWidth={2.5} 
                  fillOpacity={1} 
                  fill="url(#latencyGlow)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Devices Requiring Attention (NOC Priority Queue) */}
      {attentionDevices.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/40 p-5">
          <div className="flex items-center justify-between pb-3 border-b border-rose-200/80 mb-3">
            <div className="flex items-center gap-2 text-rose-800">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <h2 className="text-sm font-bold uppercase tracking-wider">Devices Requiring Immediate Attention ({attentionDevices.length})</h2>
            </div>
            <Link to="/devices" className="text-xs font-bold text-rose-700 hover:text-rose-800 flex items-center gap-1">
              View All <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {attentionDevices.map(d => (
              <div key={d._id} className="p-3.5 rounded-xl bg-white border border-rose-200 shadow-xs flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-slate-900 text-xs truncate">{d.name}</span>
                    <span className={clsx(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                      d.status === 'DOWN' ? "bg-rose-100 text-rose-800 border-rose-300" :
                      d.healthStatus === 'CRITICAL' ? "bg-rose-50 text-rose-700 border-rose-200" :
                      "bg-amber-50 text-amber-700 border-amber-200"
                    )}>
                      {d.status === 'DOWN' ? 'DOWN' : d.healthStatus}
                    </span>
                  </div>
                  <p className="font-mono text-xs text-slate-600">{d.ipAddress}</p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {d.vendor || 'Unknown Vendor'} • {d.reachabilityMethod ? `Method: ${d.reachabilityMethod}` : 'No Reachability Method'}
                  </p>
                </div>

                <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="font-mono text-[11px] font-bold text-slate-700">
                    Score: {d.healthScore !== null && d.healthScore !== undefined ? `${d.healthScore}/100` : 'Unscored'}
                  </span>
                  <Link 
                    to={`/devices/${d._id}`}
                    className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 font-bold text-[11px]"
                  >
                    Diagnose
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fleet Table & Incident Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Device Fleet Status Table */}
        <div className="glass-card-static rounded-2xl border border-slate-200 lg:col-span-8 overflow-hidden flex flex-col justify-between">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-sky-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Live Node Telemetry</h2>
                <p className="text-xs text-slate-500">Active campus interfaces, hardware, and reachability</p>
              </div>
            </div>
            <Link 
              to="/devices" 
              className="text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1 group"
            >
              All Assets ({devices.length}) 
              <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[11px] font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="px-5 py-3.5">Device & Identity</th>
                  <th className="px-5 py-3.5">IP / MAC</th>
                  <th className="px-5 py-3.5">Reachability</th>
                  <th className="px-5 py-3.5">Health Score</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {devices.slice(0, 7).map(device => {
                  const isUp = device.status === 'UP';
                  const isDown = device.status === 'DOWN';

                  return (
                    <tr key={device._id} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className={clsx(
                            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border",
                            isUp ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            isDown ? "bg-rose-50 text-rose-700 border-rose-200" :
                            "bg-amber-50 text-amber-700 border-amber-200"
                          )}>
                            {device.type === 'router' ? <Router className="w-3.5 h-3.5" /> :
                             device.type === 'server' ? <Server className="w-3.5 h-3.5" /> :
                             <Wifi className="w-3.5 h-3.5" />}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900">{device.name}</p>
                            <p className="text-[10px] text-slate-500">{device.vendor || device.type}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono">
                        <div>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-semibold">
                            {device.ipAddress}
                          </span>
                          {device.macAddress && (
                            <p className="text-[10px] text-slate-400 mt-0.5 font-mono">{device.macAddress}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="px-2 py-0.5 rounded bg-sky-50 text-sky-800 border border-sky-200 text-[10px] font-mono font-bold uppercase">
                          {device.reachabilityMethod || 'ICMP'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        {device.healthScore !== null && device.healthScore !== undefined ? (
                          <span className={clsx(
                            "px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border",
                            device.healthScore >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            device.healthScore >= 60 ? "bg-amber-50 text-amber-700 border-amber-200" :
                            "bg-rose-50 text-rose-700 border-rose-200"
                          )}>
                            {device.healthScore}/100
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-mono">N/A</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={clsx(
                          "px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase flex items-center w-fit gap-1.5 border",
                          isUp ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          isDown ? "bg-rose-50 text-rose-700 border-rose-200" :
                          "bg-amber-50 text-amber-700 border-amber-200"
                        )}>
                          <span className={clsx(
                            "w-1.5 h-1.5 rounded-full",
                            isUp ? "bg-emerald-500 animate-pulse" :
                            isDown ? "bg-rose-500 animate-pulse" : "bg-amber-500"
                          )} />
                          {device.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <Link 
                          to={`/devices/${device._id}`}
                          className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-[11px] font-bold transition-all"
                        >
                          Telemetry
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Incident Stream */}
        <div className="glass-card-static rounded-2xl border border-slate-200 lg:col-span-4 flex flex-col justify-between overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Incident Stream</h2>
                <p className="text-xs text-slate-500">Live trigger alerts</p>
              </div>
            </div>
            <Link to="/alerts" className="text-xs text-sky-600 hover:text-sky-700 font-bold">
              View Log
            </Link>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-2.5 max-h-[380px]">
            {alerts.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                No active critical incidents.
              </div>
            ) : (
              alerts.map(alert => (
                <div 
                  key={alert._id} 
                  className={clsx(
                    "p-3 rounded-xl border text-xs transition-all",
                    alert.severity === 'CRITICAL' ? "bg-rose-50/70 border-rose-200 text-slate-800" :
                    alert.severity === 'HIGH' ? "bg-amber-50/70 border-amber-200 text-slate-800" :
                    "bg-slate-50 border-slate-200 text-slate-800"
                  )}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className={clsx(
                      "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                      alert.severity === 'CRITICAL' ? "bg-rose-100 text-rose-800 border-rose-200" :
                      alert.severity === 'HIGH' ? "bg-amber-100 text-amber-800 border-amber-200" :
                      "bg-sky-100 text-sky-800 border-sky-200"
                    )}>
                      {alert.severity}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {format(new Date(alert.createdAt), 'HH:mm:ss')}
                    </span>
                  </div>
                  <p className="font-bold text-slate-900 text-xs mt-1">{alert.message}</p>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">{alert.device?.name || 'Network Node'}</p>
                </div>
              ))
            )}
          </div>
        </div>

      </div>

    </div>
  );
};

export default Dashboard;