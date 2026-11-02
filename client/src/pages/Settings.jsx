import React, { useState, useEffect, useContext } from 'react';
import api from '../services/api';
import { Save, ShieldAlert, Zap, RotateCcw, Check } from 'lucide-react';
import clsx from 'clsx';
import { AuthContext } from '../context/AuthContext';

const Settings = () => {
  const { user } = useContext(AuthContext);
  const isAdmin = user?.role === 'admin';
  const [settings, setSettings] = useState({
    SIMULATION_MODE: true,
    EMERGENCY_STOP: false,
    DISCOVERY_AUTHORIZATION_MODE: 'dual',
    NETWORK_AUTHORIZATION_POLICY: {
      mode: 'legacy_allowlists',
      autoAuthorizeInterfaces: false,
      interfaceTypes: [],
      maxHosts: 256
    },
    LATENCY_WARNING: 100,
    LATENCY_CRITICAL: 250,
    PACKET_LOSS_WARNING: 5,
    PACKET_LOSS_CRITICAL: 15
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [networkPolicyConfigured, setNetworkPolicyConfigured] = useState(false);
  const [syncingNetworks, setSyncingNetworks] = useState(false);
  const [networkSyncResult, setNetworkSyncResult] = useState(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await api.get('/settings');
      setNetworkPolicyConfigured(Object.prototype.hasOwnProperty.call(res.data, 'NETWORK_AUTHORIZATION_POLICY'));
      setSettings(prev => ({
        ...prev,
        ...res.data,
        SIMULATION_MODE: Boolean(res.data.SIMULATION_MODE === true || res.data.SIMULATION_MODE === 'true'),
        EMERGENCY_STOP: Boolean(res.data.EMERGENCY_STOP === true || res.data.EMERGENCY_STOP === 'true'),
        DISCOVERY_AUTHORIZATION_MODE: res.data.DISCOVERY_AUTHORIZATION_MODE === 'subnet_registry'
          ? 'subnet_registry'
          : 'dual',
        NETWORK_AUTHORIZATION_POLICY: {
          mode: res.data.NETWORK_AUTHORIZATION_POLICY?.mode === 'application_managed'
            ? 'application_managed'
            : 'legacy_allowlists',
          autoAuthorizeInterfaces: res.data.NETWORK_AUTHORIZATION_POLICY?.autoAuthorizeInterfaces === true,
          interfaceTypes: Array.isArray(res.data.NETWORK_AUTHORIZATION_POLICY?.interfaceTypes)
            ? res.data.NETWORK_AUTHORIZATION_POLICY.interfaceTypes
            : [],
          maxHosts: Number(res.data.NETWORK_AUTHORIZATION_POLICY?.maxHosts) || 256,
        },
      }));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const updateNetworkPolicy = (update) => {
    setNetworkPolicyConfigured(true);
    setSettings(prev => ({
      ...prev,
      NETWORK_AUTHORIZATION_POLICY: {
        ...prev.NETWORK_AUTHORIZATION_POLICY,
        ...update
      }
    }));
  };

  const handleSynchronizeNetworks = async () => {
    setSyncingNetworks(true);
    setNetworkSyncResult(null);
    try {
      const response = await api.post('/devices/network-interfaces/synchronize');
      setNetworkSyncResult(response.data);
    } catch (error) {
      console.error(error);
      setNetworkSyncResult({ error: error.response?.data?.message || 'Unable to synchronize connected networks' });
    } finally {
      setSyncingNetworks(false);
    }
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      const updates = { ...settings };
      if (!networkPolicyConfigured) delete updates.NETWORK_AUTHORIZATION_POLICY;
      await api.put('/settings', updates);
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
      [name]: type === 'checkbox' ? checked : type === 'number' ? Number(value) : value
    }));
  };

  const handleResetDefaults = () => {
    setNetworkPolicyConfigured(true);
    setSettings({
      SIMULATION_MODE: true,
      EMERGENCY_STOP: false,
      DISCOVERY_AUTHORIZATION_MODE: 'dual',
      NETWORK_AUTHORIZATION_POLICY: {
        mode: 'legacy_allowlists',
        autoAuthorizeInterfaces: false,
        interfaceTypes: [],
        maxHosts: 256
      },
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

      <div className="glass-card-static rounded-2xl border border-rose-300 bg-rose-50 overflow-hidden shadow-xs">
        <label className="p-6 flex items-start gap-4 cursor-pointer">
          <input
            type="checkbox"
            name="EMERGENCY_STOP"
            checked={Boolean(settings.EMERGENCY_STOP)}
            onChange={handleChange}
            className="mt-1 w-5 h-5 rounded border-rose-300 text-rose-600 focus:ring-rose-500 cursor-pointer"
          />
          <div>
            <h2 className="text-sm font-bold text-rose-800">Emergency stop for active probes</h2>
            <p className="mt-1 text-xs text-rose-700">
              When enabled, the monitoring engine starts no new ICMP or SNMP collection work. In-flight probes are bounded by their configured timeout.
            </p>
          </div>
        </label>
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
              <p className="text-xs text-slate-500">Choose simulated data or real probes restricted to server-approved targets</p>
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
                When enabled, the engine generates clearly labelled simulation observations and sends no network probes. Live monitoring and discovery require active, approved private subnet records. Legacy mode also requires the environment allowlists; application-managed mode replaces those static checks but never removes subnet, enrollment, interface-scope, rate, or emergency-stop controls.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="glass-card-static rounded-2xl border border-sky-200 bg-sky-50/60 overflow-hidden shadow-xs">
        <div className="p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Network authorization policy</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Application-managed mode uses active, approved subnet records instead of per-IP environment allowlists for both discovery and monitoring. Empty allowlists never grant access: a private subnet record, approved enrollment, and explicit device monitoring setting are still required.
            </p>
            {!networkPolicyConfigured && (
              <p className="mt-2 text-xs text-amber-800">
                The unified policy has not been saved yet. Existing discovery authorization settings remain in effect until an administrator selects and saves a mode.
              </p>
            )}
          </div>
          <label className="block max-w-xl text-xs font-semibold text-slate-700">
            Authorization mode
            <select
              value={settings.NETWORK_AUTHORIZATION_POLICY.mode}
              onChange={(e) => updateNetworkPolicy({
                mode: e.target.value,
                ...(e.target.value === 'legacy_allowlists' ? { autoAuthorizeInterfaces: false } : {})
              })}
              disabled={!isAdmin}
              className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="legacy_allowlists">Legacy: approved subnets + environment allowlists</option>
              <option value="application_managed">Application-managed subnet authorization</option>
            </select>
          </label>
          {settings.NETWORK_AUTHORIZATION_POLICY.mode === 'application_managed' && (
            <div className="space-y-4 rounded-xl border border-sky-200 bg-white/80 p-4">
              <label className="flex items-start gap-3 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={settings.NETWORK_AUTHORIZATION_POLICY.autoAuthorizeInterfaces}
                  onChange={(e) => updateNetworkPolicy({ autoAuthorizeInterfaces: e.target.checked })}
                  disabled={!isAdmin}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="font-bold">Automatically authorize eligible connected interfaces</span>
                  <span className="mt-1 block text-slate-500">This registers only currently connected, in-scope RFC1918 networks. It never starts discovery or enables monitoring automatically.</span>
                </span>
              </label>
              <div>
                <p className="text-xs font-bold text-slate-700">Allowed interface types (explicit scope)</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  {[
                    ['wireless', 'Wi-Fi'],
                    ['ethernet', 'Ethernet'],
                    ['hotspot', 'Mobile hotspot'],
                    ['virtual', 'Virtual / VPN (higher risk)']
                  ].map(([value, label]) => (
                    <label key={value} className="inline-flex items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={settings.NETWORK_AUTHORIZATION_POLICY.interfaceTypes.includes(value)}
                        onChange={(e) => {
                          const currentTypes = settings.NETWORK_AUTHORIZATION_POLICY.interfaceTypes;
                          const nextTypes = e.target.checked
                            ? [...currentTypes, value]
                            : currentTypes.filter((type) => type !== value);
                          updateNetworkPolicy({
                            interfaceTypes: nextTypes,
                            ...(nextTypes.length === 0 ? { autoAuthorizeInterfaces: false } : {})
                          });
                        }}
                        disabled={!isAdmin}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="block max-w-xs text-xs font-semibold text-slate-700">
                Maximum usable hosts per interface network
                <input
                  type="number"
                  min="1"
                  max="256"
                  value={settings.NETWORK_AUTHORIZATION_POLICY.maxHosts}
                  onChange={(e) => updateNetworkPolicy({ maxHosts: Number(e.target.value) })}
                  disabled={!isAdmin || !settings.NETWORK_AUTHORIZATION_POLICY.autoAuthorizeInterfaces}
                  className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm disabled:bg-slate-100"
                />
                <span className="mt-1 block font-normal text-slate-500">Hard-capped at 256 hosts per subnet.</span>
              </label>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSynchronizeNetworks}
              disabled={!isAdmin || syncingNetworks}
              className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncingNetworks ? 'Synchronizing...' : 'Synchronize connected networks now'}
            </button>
            <span className="text-[11px] text-slate-500">Authorization sync only; does not probe or discover devices.</span>
          </div>
          {networkSyncResult && (
            <p role="status" className={clsx(
              'text-xs',
              networkSyncResult.error || networkSyncResult.reason === 'application_managed_mode_disabled'
                ? 'text-amber-800'
                : 'text-emerald-700'
            )}>
              {networkSyncResult.error
                || networkSyncResult.reason
                || `Authorized ${networkSyncResult.authorized || 0}, refreshed ${networkSyncResult.refreshed || 0}, disconnected ${networkSyncResult.disconnected || 0}, skipped ${networkSyncResult.skippedInterfaces || 0}.`}
            </p>
          )}
          {!isAdmin && <p className="text-xs text-slate-500">Only administrators can change policy or synchronize interface authorization.</p>}
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
