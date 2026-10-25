import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Save, ShieldAlert, Zap, RotateCcw, Check } from 'lucide-react';
import clsx from 'clsx';

const Settings = () => {
  const [settings, setSettings] = useState({
    SIMULATION_MODE: true,
    LATENCY_WARNING: 100,
    LATENCY_CRITICAL: 250,
    PACKET_LOSS_WARNING: 5,
    PACKET_LOSS_CRITICAL: 15
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      setSettings(prev => ({
        ...prev,
        ...res.data,
        SIMULATION_MODE: Boolean(res.data.SIMULATION_MODE === true || res.data.SIMULATION_MODE === 'true')
      }));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      await api.put('/settings', settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error(error);
      alert('Error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSettings(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : Number(value)
    }));
  };

  const handleResetDefaults = () => {
    setSettings({
      SIMULATION_MODE: true,
      LATENCY_WARNING: 100,
      LATENCY_CRITICAL: 250,
      PACKET_LOSS_WARNING: 5,
      PACKET_LOSS_CRITICAL: 15
    });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <div className="w-8 h-8 rounded-full border-2 border-sky-200 border-t-sky-600 animate-spin" />
        <p className="text-xs text-slate-500">Loading engine parameters...</p>
      </div>
    );
  }

  const isSim = Boolean(settings.SIMULATION_MODE);

  return (
    <div className="space-y-6 max-w-4xl pb-12">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            System & Engine Configuration
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Global monitoring telemetry parameters, probing engines, and alert threshold limits
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button 
            type="button"
            onClick={handleResetDefaults}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Defaults
          </button>

          <button 
            onClick={handleSave} 
            disabled={saving}
            className={clsx(
              "px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm",
              saveSuccess 
                ? "bg-emerald-600 text-white shadow-emerald-500/20"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20"
            )}
          >
            {saveSuccess ? (
              <>
                <Check className="w-4 h-4 stroke-[3]" /> Saved Successfully
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> {saving ? 'Writing Config...' : 'Apply Changes'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Monitoring Engine Mode Card */}
      <div className="glass-card-static rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-50 border border-sky-200 flex items-center justify-center text-sky-600">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Telemetry Engine Mode</h2>
              <p className="text-xs text-slate-500">Choose between simulated demonstration data or real hardware ICMP/SNMP probes</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <label className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 cursor-pointer transition-all">
            <input 
              type="checkbox" 
              name="SIMULATION_MODE"
              checked={isSim}
              onChange={handleChange}
              className="mt-1 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 bg-white cursor-pointer"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-900">Enable Virtual Simulation Mode</span>
                <span className={clsx(
                  "px-2 py-0.5 text-[10px] font-bold rounded-full border uppercase font-mono",
                  isSim ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-emerald-50 text-emerald-800 border-emerald-200"
                )}>
                  {isSim ? 'Virtual Traffic Active' : 'Real Hardware Ping Active'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                When enabled, the background engine synthesizes realistic randomized ping variations, interface octets, and occasional packet drops for demonstration. Uncheck this option to dispatch actual ICMP echo requests and SNMP OID queries across your local network.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Alert Thresholds Card */}
      <div className="glass-card-static rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="p-6 border-b border-slate-200 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Incident & Alarm Thresholds</h2>
            <p className="text-xs text-slate-500">Specify millisecond and packet drop limits for automated alert generation</p>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          
          <div className="space-y-2">
            <label className="block text-slate-700 font-bold flex items-center justify-between">
              <span>Latency Warning Limit</span>
              <span className="text-amber-700 font-mono font-bold">{settings.LATENCY_WARNING} ms</span>
            </label>
            <input 
              type="number" 
              name="LATENCY_WARNING"
              value={settings.LATENCY_WARNING}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 font-mono focus:outline-none focus:border-blue-500 shadow-2xs"
            />
            <p className="text-[11px] text-slate-400">Triggers MEDIUM severity incident when node latency exceeds this value.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-slate-700 font-bold flex items-center justify-between">
              <span>Latency Critical Limit</span>
              <span className="text-rose-700 font-mono font-bold">{settings.LATENCY_CRITICAL} ms</span>
            </label>
            <input 
              type="number" 
              name="LATENCY_CRITICAL"
              value={settings.LATENCY_CRITICAL}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 font-mono focus:outline-none focus:border-blue-500 shadow-2xs"
            />
            <p className="text-[11px] text-slate-400">Triggers HIGH severity alarm requiring immediate administrator intervention.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-slate-700 font-bold flex items-center justify-between">
              <span>Packet Loss Warning Limit</span>
              <span className="text-amber-700 font-mono font-bold">{settings.PACKET_LOSS_WARNING} %</span>
            </label>
            <input 
              type="number" 
              name="PACKET_LOSS_WARNING"
              value={settings.PACKET_LOSS_WARNING}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 font-mono focus:outline-none focus:border-blue-500 shadow-2xs"
            />
            <p className="text-[11px] text-slate-400">Threshold for intermittent interface packet degradation.</p>
          </div>

          <div className="space-y-2">
            <label className="block text-slate-700 font-bold flex items-center justify-between">
              <span>Packet Loss Critical Limit</span>
              <span className="text-rose-700 font-mono font-bold">{settings.PACKET_LOSS_CRITICAL} %</span>
            </label>
            <input 
              type="number" 
              name="PACKET_LOSS_CRITICAL"
              value={settings.PACKET_LOSS_CRITICAL}
              onChange={handleChange}
              className="w-full bg-white border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 font-mono focus:outline-none focus:border-blue-500 shadow-2xs"
            />
            <p className="text-[11px] text-slate-400">Threshold for acute carrier loss or link disruption.</p>
          </div>

        </div>
      </div>

    </div>
  );
};

export default Settings;
