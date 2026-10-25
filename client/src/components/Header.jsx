import React, { useContext, useState, useEffect, useRef } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { getSocket } from '../services/socket';
import api from '../services/api';
import { 
  Bell, 
  User, 
  LogOut, 
  Menu, 
  Clock, 
  Zap, 
  ChevronRight,
  ShieldAlert
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const pageMeta = {
  '/': { title: 'Live NOC Command Overview', desc: 'Real-time telemetry, node reachability, and network health index' },
  '/devices': { title: 'Device Fleet & Asset Inventory', desc: 'Managed switches, routers, gateways, and hardware nodes' },
  '/network-map': { title: 'Network Topology Visualizer', desc: 'Interactive node graph and interconnect routing paths' },
  '/performance': { title: 'Latency & Health Telemetry', desc: 'Historical round-trip time, packet drop metrics, and trendlines' },
  '/traffic': { title: 'Network Flow & Bandwidth Analytics', desc: 'Inbound and outbound throughput statistics across interfaces' },
  '/alerts': { title: 'Incident Response & Alerts Center', desc: 'Active system warnings, critical thresholds, and audit log' },
  '/reports': { title: 'Diagnostics & System Reports', desc: 'Downloadable health summaries and compliance logs' },
  '/settings': { title: 'System & Engine Configuration', desc: 'Tuning probe frequencies, simulation modes, and notification rules' },
};

const Header = ({ onToggleMobileMenu }) => {
  const { user, logout } = useContext(AuthContext);
  const location = useLocation();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [alerts, setAlerts] = useState([]);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [simMode, setSimMode] = useState(true);
  const [loadingToggle, setLoadingToggle] = useState(false);
  const dropdownRef = useRef(null);

  const currentPath = location.pathname.startsWith('/devices/') ? '/devices' : location.pathname;
  const currentMeta = pageMeta[currentPath] || { title: 'Network Observability', desc: 'Real-time monitoring and analytics' };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    api.get('/settings')
      .then(res => {
        if (res.data && res.data.SIMULATION_MODE !== undefined) {
          setSimMode(Boolean(res.data.SIMULATION_MODE === true || res.data.SIMULATION_MODE === 'true'));
        }
      })
      .catch(() => {});

    api.get('/alerts')
      .then(res => {
        setAlerts(res.data.slice(0, 8));
      })
      .catch(() => {});

    const socket = getSocket();
    if (socket) {
      socket.on('newAlert', (newAlert) => {
        setAlerts(prev => [newAlert, ...prev].slice(0, 8));
      });
    }

    return () => {
      if (socket) socket.off('newAlert');
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsAlertOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleSimulation = async () => {
    setLoadingToggle(true);
    try {
      const nextMode = !simMode;
      await api.put('/settings', { SIMULATION_MODE: nextMode });
      setSimMode(nextMode);
    } catch (err) {
      console.error('Failed to toggle simulation mode', err);
    } finally {
      setLoadingToggle(false);
    }
  };

  const activeAlerts = alerts.filter(a => a.status === 'ACTIVE');

  return (
    <header className="h-20 bg-white/95 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 shrink-0 relative z-30 shadow-xs">
      
      {/* Left side: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleMobileMenu}
          className="md:hidden text-slate-600 hover:text-slate-900 p-2 rounded-xl bg-slate-100 border border-slate-200 focus:outline-none"
          aria-label="Toggle Navigation"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            {currentMeta.title}
          </h1>
          <p className="text-xs text-slate-500 hidden sm:block font-medium">
            {currentMeta.desc}
          </p>
        </div>
      </div>

      {/* Right side: Controls, Clock, Alerts, Profile */}
      <div className="flex items-center gap-3 sm:gap-4">
        
        {/* Simulation Switcher */}
        <button
          onClick={toggleSimulation}
          disabled={loadingToggle}
          title="Click to toggle Simulation vs Real Ping"
          className={clsx(
            "hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all duration-200 cursor-pointer shadow-xs",
            simMode 
              ? "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
              : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
          )}
        >
          <Zap className={clsx("w-3.5 h-3.5", simMode ? "text-amber-600" : "text-emerald-600")} />
          <span>{simMode ? 'Simulation Active' : 'Real Hardware Ping'}</span>
          <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
        </button>

        {/* Real-time Clock */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-xs font-mono font-medium">
          <Clock className="w-3.5 h-3.5 text-sky-600" />
          <span>{format(currentTime, 'HH:mm:ss')}</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500">{format(currentTime, 'EEE, MMM d')}</span>
        </div>

        {/* Notifications Popover */}
        <div className="relative" ref={dropdownRef}>
          <button 
            onClick={() => setIsAlertOpen(prev => !prev)}
            className="relative p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-700 hover:text-slate-900 transition-colors cursor-pointer"
            aria-label="Alerts"
          >
            <Bell className="w-4 h-4" />
            {activeAlerts.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-xs">
                {activeAlerts.length}
              </span>
            )}
          </button>

          {/* Dropdown Menu */}
          {isAlertOpen && (
            <div className="absolute right-0 mt-3 w-80 sm:w-96 rounded-2xl bg-white border border-slate-200 shadow-2xl p-4 space-y-3 z-50">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-sky-600" />
                  <span className="text-sm font-bold text-slate-900">Incident Stream</span>
                </div>
                <Link 
                  to="/alerts" 
                  onClick={() => setIsAlertOpen(false)}
                  className="text-xs text-sky-600 hover:text-sky-700 font-bold flex items-center gap-1"
                >
                  View All <ChevronRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {alerts.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No active incident alerts. Network healthy.
                  </div>
                ) : (
                  alerts.slice(0, 5).map(alert => (
                    <div 
                      key={alert._id} 
                      className={clsx(
                        "p-2.5 rounded-xl border text-xs transition-colors",
                        alert.severity === 'CRITICAL' ? "bg-rose-50 border-rose-200 text-rose-900" :
                        alert.severity === 'HIGH' ? "bg-amber-50 border-amber-200 text-amber-900" :
                        "bg-slate-50 border-slate-200 text-slate-800"
                      )}
                    >
                      <div className="flex items-center justify-between font-bold mb-1">
                        <span className="uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                          <span className={clsx(
                            "w-1.5 h-1.5 rounded-full",
                            alert.severity === 'CRITICAL' ? "bg-rose-500" :
                            alert.severity === 'HIGH' ? "bg-amber-500" : "bg-sky-500"
                          )} />
                          {alert.severity}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {format(new Date(alert.createdAt), 'HH:mm:ss')}
                        </span>
                      </div>
                      <p className="font-semibold text-slate-900">{alert.message}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{alert.device?.name || 'Gateway'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="h-7 w-px bg-slate-200" />

        {/* User Profile */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 pl-1">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-600 flex items-center justify-center font-bold text-white shadow-xs text-xs">
                {user?.name ? user.name.slice(0, 2).toUpperCase() : 'AD'}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
            </div>
            <div className="hidden md:block text-left">
              <p className="text-xs font-bold text-slate-900 tracking-tight leading-none">{user?.name || 'Administrator'}</p>
              <p className="text-[10px] font-bold text-sky-600 tracking-wider uppercase mt-1 leading-none">{user?.role || 'Admin'}</p>
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={logout}
            title="Sign Out"
            className="p-2.5 rounded-xl bg-slate-100 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-500 hover:text-rose-600 transition-all duration-200 cursor-pointer"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

      </div>
    </header>
  );
};

export default Header;
