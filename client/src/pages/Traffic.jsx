import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight, Zap, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { mapTrafficRecords, summarizeTraffic } from '../services/trafficMetrics';

const Traffic = () => {
  const [traffic, setTraffic] = useState([]);
  const [unavailableDevices, setUnavailableDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTraffic = useCallback(async () => {
    setLoading(true);
    try {
      const [res, devicesRes] = await Promise.all([
        api.get('/analytics/traffic'),
        api.get('/devices')
      ]);

      const formatted = mapTrafficRecords(res.data, devicesRes.data);
      const devicesWithThroughput = new Set(
        formatted.filter(row => row.total !== null).map(row => row.deviceId),
      );
      setUnavailableDevices(devicesRes.data
        .filter(device => !devicesWithThroughput.has(String(device._id)))
        .map(device => ({
          name: device.name,
          ipAddress: device.ipAddress,
          reason: device.monitoringAuthorized === false
            ? device.monitoringAuthorizationReason
            : device.latestMetric?.derived?.unavailableMetrics?.inboundThroughput
              || device.latestMetric?.reasonUnavailable
              || (device.latestMetric
                ? 'No valid interface-counter throughput sample is available'
                : 'No measurements recorded in the last 7 days'),
        })));
      setTraffic(formatted);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTraffic();
  }, [fetchTraffic]);

  const { meanIncoming, meanOutgoing, busiestInterface, hasThroughputData } = summarizeTraffic(traffic);

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Network Flow & Bandwidth Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Average configured-interface throughput over one hour; real and simulated sources remain distinct
          </p>
        </div>

        <button 
          onClick={fetchTraffic}
          className="p-2.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer self-start sm:self-auto shadow-2xs"
          title="Refresh Throughput"
        >
          <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>MEAN INBOUND (RX)</span>
            <ArrowDownLeft className="w-4 h-4 text-sky-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{meanIncoming === null ? 'Unavailable' : meanIncoming.toFixed(2)}</span>
            {meanIncoming !== null && <span className="text-xs text-slate-500 font-sans">Mbit/s</span>}
          </div>
          <div className="mt-2 text-[11px] text-sky-700 font-semibold">
            {meanIncoming === null ? 'No throughput data available' : `Mean of ${traffic.filter(row => row.Incoming !== null).length} available interfaces; not a campus-wide total`}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-sky-500" />
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>MEAN OUTBOUND (TX)</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{meanOutgoing === null ? 'Unavailable' : meanOutgoing.toFixed(2)}</span>
            {meanOutgoing !== null && <span className="text-xs text-slate-500 font-sans">Mbit/s</span>}
          </div>
          <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
            Real and simulated values are separately labelled in the chart
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500" />
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>BUSIEST HARDWARE NODE</span>
            <Zap className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 truncate">
            {busiestInterface ? busiestInterface.name : 'Unavailable'}
          </div>
          <div className="mt-2 text-[11px] text-purple-700 font-semibold font-mono">
            {busiestInterface ? `${busiestInterface.total.toFixed(2)} Mbit/s combined on that interface` : 'No throughput data available'}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-purple-500" />
        </div>
      </div>

      {/* Main Throughput Bar Chart */}
      <div className="glass-card-static rounded-2xl p-6 border border-slate-200 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-sky-600" />
              Comparative Throughput by Configured Device Interface (Mbit/s)
            </h2>
            <p className="text-xs text-slate-500">Inbound (Blue) vs Outbound (Green) metrics</p>
          </div>
        </div>

        {loading ? (
          <div className="py-24 text-center text-xs text-slate-400">Calculating network octets...</div>
        ) : !hasThroughputData ? (
          <div className="py-24 text-center text-sm text-slate-500">No throughput data available.</div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={traffic} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v} Mbit/s`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '0.75rem', fontSize: '12px', color: '#0f172a' }}
                />
                <Legend wrapperStyle={{ paddingTop: '15px', fontSize: '12px' }} />
                <Bar dataKey="Incoming" fill="#0284c7" radius={[4, 4, 0, 0]} name="Inbound (RX)" />
                <Bar dataKey="Outgoing" fill="#059669" radius={[4, 4, 0, 0]} name="Outbound (TX)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {!loading && unavailableDevices.length > 0 && (
          <div className="space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {unavailableDevices.map(device => (
              <p key={device.ipAddress}>
                <span className="font-semibold text-slate-700">{device.name} ({device.ipAddress}):</span> {device.reason}
              </p>
            ))}
          </div>
        )}
      </div>

    </div>
  );
};

export default Traffic;
