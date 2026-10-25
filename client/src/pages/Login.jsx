import React, { useState, useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { Radio, Mail, Lock, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react';
import { AuthContext } from '../context/AuthContext';
import clsx from 'clsx';

const Login = () => {
  const [email, setEmail] = useState('admin@college.edu');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, user } = useContext(AuthContext);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError('Invalid operator credentials. Please check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleFillDemo = () => {
    setEmail('admin@college.edu');
    setPassword('password123');
  };

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 bg-light-grid p-4 relative overflow-hidden">
      
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -top-40 left-1/4 w-[600px] h-[400px] bg-sky-200/40 rounded-full blur-[140px]" />
      <div className="pointer-events-none absolute -bottom-40 right-1/4 w-[600px] h-[400px] bg-indigo-100/50 rounded-full blur-[140px]" />

      <div className="w-full max-w-md relative z-10">
        
        {/* Main Glass Card */}
        <div className="bg-white rounded-3xl p-8 sm:p-10 border border-slate-200 shadow-xl">
          
          {/* Brand Header */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="relative flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-600 via-blue-600 to-indigo-600 shadow-md mb-4">
              <Radio className="w-7 h-7 text-white animate-pulse" />
              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 ring-4 ring-white animate-ping" />
            </div>

            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-black tracking-tight text-slate-900">
                PulseNet NOC
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase bg-sky-50 text-sky-700 border border-sky-200 rounded-md">
                v2.4
              </span>
            </div>
            
            <p className="text-xs text-slate-500 font-medium">Enterprise Observability & Security Clearance</p>
          </div>

          {/* Quick Demo Credentials Pill */}
          <button
            type="button"
            onClick={handleFillDemo}
            className="w-full mb-6 p-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 text-xs font-bold flex items-center justify-between transition-colors cursor-pointer group"
          >
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-sky-600" />
              Demo: admin@college.edu / password123
            </span>
            <span className="text-[10px] text-sky-600 group-hover:translate-x-0.5 transition-transform uppercase font-mono">
              Auto-fill →
            </span>
          </button>

          {/* Error notice */}
          {error && (
            <div className="bg-rose-50 text-rose-700 border border-rose-200 px-4 py-3 rounded-xl text-xs font-bold mb-6">
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            
            <div>
              <label className="block font-bold text-slate-700 mb-1.5">Operator Identifier / Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@college.edu"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono shadow-2xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1.5">Security Passkey</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono shadow-2xs"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer group"
              >
                <span>{loading ? 'Authenticating Operator...' : 'Authenticate & Enter NOC'}</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </button>
            </div>

          </form>

          {/* Footer security note */}
          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              End-to-End Encrypted Observability Tunnel
            </p>
          </div>

        </div>

      </div>

    </div>
  );
};

export default Login;
