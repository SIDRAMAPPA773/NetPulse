import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Server, 
  Activity, 
  AlertTriangle, 
  Settings, 
  Network, 
  ArrowLeftRight, 
  FileText,
  Radio,
  X
} from 'lucide-react';
import clsx from 'clsx';

const Sidebar = ({ mobileOpen, setMobileOpen }) => {
  const navSections = [
    {
      title: 'COMMAND & CONTROL',
      items: [
        { name: 'Live Overview', path: '/', icon: LayoutDashboard, badge: 'Live' },
        { name: 'Device Inventory', path: '/devices', icon: Server },
        { name: 'Topology Map', path: '/network-map', icon: Network },
      ]
    },
    {
      title: 'TELEMETRY & FLOWS',
      items: [
        { name: 'Performance', path: '/performance', icon: Activity },
        { name: 'Traffic Analytics', path: '/traffic', icon: ArrowLeftRight },
        { name: 'Incident Alerts', path: '/alerts', icon: AlertTriangle },
      ]
    },
    {
      title: 'MANAGEMENT',
      items: [
        { name: 'Audit Reports', path: '/reports', icon: FileText },
        { name: 'Engine Settings', path: '/settings', icon: Settings },
      ]
    }
  ];

  const content = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200 shadow-xs">
      {/* Brand Header */}
      <div className="h-20 flex items-center justify-between px-6 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-600 via-blue-600 to-indigo-600 shadow-md">
            <Radio className="w-5 h-5 text-white animate-pulse" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white animate-ping" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-lg font-extrabold tracking-tight text-slate-900">
                PulseNet
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-bold tracking-widest uppercase bg-sky-50 text-sky-700 border border-sky-200 rounded">
                NOC
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium">Enterprise Observability</p>
          </div>
        </div>

        {/* Close button for mobile */}
        {setMobileOpen && (
          <button 
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-slate-400 hover:text-slate-700 p-1 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Nav Menu */}
      <nav className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        {navSections.map((section, idx) => (
          <div key={idx} className="space-y-1.5">
            <h3 className="px-3 text-[10px] font-bold tracking-widest uppercase text-slate-400">
              {section.title}
            </h3>
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  onClick={() => setMobileOpen && setMobileOpen(false)}
                  className={({ isActive }) =>
                    clsx(
                      'group relative flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200',
                      isActive
                        ? 'bg-sky-50 text-sky-700 font-bold border border-sky-200/80 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 border border-transparent'
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className="flex items-center gap-3">
                        <item.icon className={clsx(
                          "w-4 h-4 transition-transform group-hover:scale-110",
                          isActive ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"
                        )} />
                        <span>{item.name}</span>
                      </div>

                      {item.badge && (
                        <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {item.badge}
                        </span>
                      )}

                      {/* Active indicator bar */}
                      {isActive && (
                        <span className="absolute left-0 top-2 bottom-2 w-1 bg-sky-600 rounded-r-full" />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Telemetry Status Widget */}
      <div className="p-4 border-t border-slate-200 bg-slate-50/50">
        <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-bold text-slate-800">Engine Online</span>
            </div>
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              10s TICK
            </span>
          </div>

          <div className="space-y-1 text-[11px] text-slate-500 border-t border-slate-100 pt-2 font-mono flex justify-between">
            <span>Protocol:</span>
            <span className="text-sky-700 font-semibold">ICMP + SNMPv2</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="w-64 hidden md:block shrink-0 h-full z-20">
        {content}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div 
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-xs h-full z-10 shadow-2xl">
            {content}
          </div>
        </div>
      )}
    </>
  );
};

export default Sidebar;
