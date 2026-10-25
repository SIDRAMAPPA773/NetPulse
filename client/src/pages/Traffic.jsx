import React, { useState, useEffect } from 'react';
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

const Traffic = () => {
  const [traffic, setTraffic] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTraffic();
  }, []);

  const fetchTraffic = async () => {
    setLoading(true);
    try {
      const [res, devicesRes] = await Promise.all([
        api.get('/analytics/traffic'),
        api.get('/devices')
      ]);

      const devicesMap = devicesRes.data.reduce((acc, d) => {
        acc[d._id] = d.name;
        return acc;
      }, {});

      const formatted = res.data.map(t => {
        const inKB = Math.round((t.avgIncoming || 0) / 1024);
        const outKB = Math.round((t.avgOutgoing || 0) / 1024);
        return {
          name: devicesMap[t._id] || 'Node',
          Incoming: inKB,
          Outgoing: outKB,
          total: inKB + outKB
        };
      });

      setTraffic(formatted);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const totalIn = traffic.reduce((acc, t) => acc + t.Incoming, 0);
  const totalOut = traffic.reduce((acc, t) => acc + t.Outgoing, 0);
  const peakNode = traffic.length ? [...traffic].sort((a, b) => b.total - a.total)[0] : null;

  return (
    <div className="space-y-6 pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Network Flow & Bandwidth Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time interface throughput, inbound ingress, and outbound egress telemetry
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
            <span>AGGREGATE INBOUND (RX)</span>
            <ArrowDownLeft className="w-4 h-4 text-sky-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{totalIn}</span>
            <span className="text-xs text-slate-500 font-sans">KB/s</span>
          </div>
          <div className="mt-2 text-[11px] text-sky-700 font-semibold">
            {(totalIn / 1024).toFixed(2)} MB/s total ingest
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-sky-500" />
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>AGGREGATE OUTBOUND (TX)</span>
            <ArrowUpRight className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-extrabold text-slate-900 font-mono">{totalOut}</span>
            <span className="text-xs text-slate-500 font-sans">KB/s</span>
          </div>
          <div className="mt-2 text-[11px] text-emerald-700 font-semibold">
            {(totalOut / 1024).toFixed(2)} MB/s total egress
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500" />
        </div>

        <div className="glass-card rounded-2xl p-5 border border-slate-200 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-500 font-bold mb-2">
            <span>BUSIEST HARDWARE NODE</span>
            <Zap className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-xl font-extrabold text-slate-900 truncate">
            {peakNode ? peakNode.name : 'All Balanced'}
          </div>
          <div className="mt-2 text-[11px] text-purple-700 font-semibold font-mono">
            {peakNode ? `${peakNode.total} KB/s combined traffic` : 'Normal threshold'}
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
              Comparative Throughput by Hardware Node (KB/s)
            </h2>
            <p className="text-xs text-slate-500">Inbound (Blue) vs Outbound (Green) metrics</p>
          </div>
        </div>

        {loading ? (
          <div className="py-24 text-center text-xs text-slate-400">Calculating network octets...</div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={traffic} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v} KB/s`} />
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
      </div>

    </div>
  );
};

export default Traffic;
