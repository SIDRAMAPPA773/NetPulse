import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Plus, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import api from '../services/api';
import { AuthContext } from '../context/AuthContext';

const EMPTY_FORM = { name: '', subnetId: '' };

function heartbeatLabel(lastHeartbeatAt) {
  if (!lastHeartbeatAt) return 'Never connected';
  return Date.now() - new Date(lastHeartbeatAt).getTime() <= 3 * 60 * 1000
    ? 'Online'
    : 'Stale';
}

const Collectors = () => {
  const { user } = useContext(AuthContext);
  const isAdmin = user?.role === 'admin';
  const [collectors, setCollectors] = useState([]);
  const [subnets, setSubnets] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [issuedToken, setIssuedToken] = useState('');
  const [copied, setCopied] = useState(false);

  const eligibleSubnets = useMemo(() => subnets.filter((subnet) => (
    subnet.status === 'active'
    && subnet.approvalStatus === 'approved'
    && subnet.monitoringEnabled
    && subnet.usableHostCount <= 256
    && !collectors.some((collector) => (
      collector.status === 'active'
      && String(collector.subnet?._id || collector.subnet) === String(subnet._id)
    ))
  )), [collectors, subnets]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [collectorResponse, subnetResponse] = await Promise.all([
        api.get('/collectors'),
        api.get('/subnets'),
      ]);
      setCollectors(collectorResponse.data);
      setSubnets(subnetResponse.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to load site collectors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  const createCollector = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setIssuedToken('');
    setCopied(false);
    try {
      const { data } = await api.post('/collectors', {
        name: form.name,
        subnetId: form.subnetId,
      });
      setIssuedToken(data.token);
      setForm(EMPTY_FORM);
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to create the collector.');
    } finally {
      setSaving(false);
    }
  };

  const revokeCollector = async (collector) => {
    if (!window.confirm(`Revoke ${collector.name}? Its assigned devices will return to local monitoring.`)) return;
    setError('');
    try {
      await api.post(`/collectors/${collector._id}/revoke`);
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to revoke this collector.');
    }
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(issuedToken);
      setCopied(true);
    } catch (copyError) {
      console.error('Could not copy collector token:', copyError);
      setError('Clipboard access failed. Copy the token manually; it cannot be shown again.');
    }
  };

  if (!isAdmin) {
    return <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Administrator access is required to manage site collectors.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900">Site Collectors</h1>
          <p className="mt-1 text-sm text-slate-500">Outbound-only HTTPS agents for explicitly approved subnets.</p>
        </div>
        <button
          type="button"
          onClick={loadData}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      {issuedToken && (
        <section className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="font-bold text-amber-950">Copy this token now</h2>
              <p className="mt-1 text-sm text-amber-900">It is shown once only. Provision it as `NETPULSE_TOKEN` on the collector host and configure a trusted HTTPS backend URL.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-amber-200 bg-white p-3 font-mono text-xs text-slate-800">{issuedToken}</code>
            <button type="button" onClick={copyToken} className="inline-flex items-center gap-2 self-start rounded-lg bg-amber-800 px-3 py-2 text-xs font-bold text-white">
              <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-slate-900">Register collector</h2>
        <p className="mt-1 text-xs text-slate-500">The agent can scan only the selected subnet. Devices it discovers enter inventory as pending and remain unmonitored until approved.</p>
        <form onSubmit={createCollector} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            required
            maxLength="120"
            value={form.name}
            onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
            placeholder="Collector name"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <select
            required
            value={form.subnetId}
            onChange={(event) => setForm((previous) => ({ ...previous, subnetId: event.target.value }))}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500"
          >
            <option value="">Select approved subnet</option>
            {eligibleSubnets.map((subnet) => (
              <option key={subnet._id} value={subnet._id}>{subnet.name} · {subnet.cidr}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={saving || eligibleSubnets.length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {saving ? 'Creating…' : 'Create'}
          </button>
        </form>
        {eligibleSubnets.length === 0 && <p className="mt-2 text-xs text-amber-700">Enable monitoring on an active, approved subnet with at most 256 hosts before registering a collector.</p>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-bold text-slate-900">Registered agents</h2>
        </div>
        {loading ? (
          <p className="p-5 text-sm text-slate-500">Loading collectors…</p>
        ) : collectors.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No site collectors registered.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {collectors.map((collector) => {
              const heartbeat = heartbeatLabel(collector.lastHeartbeatAt);
              return (
                <article key={collector._id} className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-900">{collector.name}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${collector.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {collector.status}
                      </span>
                      {collector.status === 'active' && (
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${heartbeat === 'Online' ? 'text-emerald-700' : 'text-amber-700'}`}>
                          <ShieldCheck className="h-3.5 w-3.5" /> {heartbeat}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-600">{collector.subnet?.name || 'Unknown subnet'} · {collector.subnet?.cidr || 'scope unavailable'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Agent {collector.agentVersion || 'not reported'} · {collector.lastReportedDeviceCount || 0} hosts in latest report
                      {collector.lastHeartbeatAt ? ` · heartbeat ${new Date(collector.lastHeartbeatAt).toLocaleString()}` : ''}
                    </p>
                  </div>
                  {collector.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => revokeCollector(collector)}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50"
                    >
                      <XCircle className="h-4 w-4" /> Revoke token
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default Collectors;
