import React, { useEffect, useContext, useState } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { AuthContext } from '../context/AuthContext';
import { connectSocket, disconnectSocket } from '../services/socket';

const MainLayout = () => {
  const { user } = useContext(AuthContext);
  const { pathname } = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isDeviceDetails = /^\/devices\/[^/]+$/.test(pathname);

  useEffect(() => {
    if (user) {
      connectSocket();
    }
    return () => {
      disconnectSocket();
    };
  }, [user]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-800 bg-light-grid relative">
      {/* Soft ambient light highlights */}
      <div className="pointer-events-none absolute -top-40 left-1/4 w-[600px] h-[300px] bg-sky-200/40 rounded-full blur-[140px] -z-0" />
      <div className="pointer-events-none absolute top-1/2 right-0 w-[500px] h-[400px] bg-indigo-100/50 rounded-full blur-[140px] -z-0" />

      {/* Sidebar for Desktop & Mobile Drawer */}
      <Sidebar mobileOpen={mobileMenuOpen} setMobileOpen={setMobileMenuOpen} />

      {/* Main Content Area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative z-10">
        <Header onToggleMobileMenu={() => setMobileMenuOpen(prev => !prev)} />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 scroll-smooth sm:px-8">
          <div className={isDeviceDetails ? 'mx-auto w-full min-w-0' : 'mx-auto max-w-7xl'}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
