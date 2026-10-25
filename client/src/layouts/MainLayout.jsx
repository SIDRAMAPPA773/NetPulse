import React, { useEffect, useContext, useState } from 'react';
import { Outlet, Navigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import { AuthContext } from '../context/AuthContext';
import { connectSocket, disconnectSocket } from '../services/socket';

const MainLayout = () => {
  const { user } = useContext(AuthContext);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
        <main className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 scroll-smooth">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
