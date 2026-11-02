import React, { useState, useEffect, useCallback } from 'react';
import { ReactFlow, Controls, Background, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';
import { Router, Server, Wifi, ArrowUpRight, Zap, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { createTopologyNodes } from '../services/networkMapTopology';

const CustomNode = ({ data }) => {
  const isUp = data.status === 'UP';
  const isDown = data.status === 'DOWN';

  return (
    <>
      <div className={clsx(
        "px-4 py-3 rounded-2xl bg-white border transition-all duration-300 min-w-[170px] shadow-sm text-left cursor-pointer group hover:shadow-md",
        isUp ? "border-slate-300 hover:border-emerald-400" :
        isDown ? "border-rose-300 hover:border-rose-400" :
        "border-amber-300 hover:border-amber-400"
      )}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className={clsx(
            "w-7 h-7 rounded-xl flex items-center justify-center border",
            data.type === 'router' ? "bg-sky-50 text-sky-600 border-sky-200" :
            data.type === 'server' ? "bg-purple-50 text-purple-600 border-purple-200" :
            "bg-blue-50 text-blue-600 border-blue-200"
          )}>
            {data.type === 'router' ? <Router className="w-4 h-4" /> :
             data.type === 'server' ? <Server className="w-4 h-4" /> :
             <Wifi className="w-4 h-4" />}
          </div>

          <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider font-mono">
            <span className={clsx(
              "w-2 h-2 rounded-full",
              isUp ? "bg-emerald-500 animate-pulse" :
              isDown ? "bg-rose-500 animate-pulse" :
              "bg-amber-500"
            )} />
            <span className={clsx(
              isUp ? "text-emerald-700" : isDown ? "text-rose-700" : "text-amber-700"
            )}>
              {data.status}
            </span>
          </span>
        </div>

        <div className="font-bold text-slate-900 text-xs truncate group-hover:text-sky-600 transition-colors">
          {data.label}
        </div>
        <div className="text-[10px] text-slate-500 font-mono mt-0.5 tracking-tight font-medium">
          {data.ip}
        </div>

        <div className="mt-2 pt-2 border-t border-slate-100 text-[9px] text-slate-500 flex items-center justify-between font-mono">
          <span>{data.location || 'Rack Node'}</span>
          <ArrowUpRight className="w-3 h-3 text-slate-400 group-hover:text-sky-600 transition-colors" />
        </div>
      </div>
    </>
  );
};

const nodeTypes = { custom: CustomNode };

const NetworkMap = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [devicesCount, setDevicesCount] = useState(0);
  const navigate = useNavigate();

  const fetchTopology = useCallback(async () => {
    try {
      const res = await api.get('/devices');
      const devices = res.data;
      setDevicesCount(devices.length);
      setNodes(createTopologyNodes(devices));
    } catch (error) {
      console.error('Failed to load topology', error);
    }
  }, [setNodes]);

  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  const onNodeClick = (event, node) => {
    if (node.data.id && node.data.id !== 'internet') {
      navigate(`/devices/${node.data.id}`);
    }
  };

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col space-y-4 pb-4">
      
      {/* Top Topology Summary Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            Dynamic Network Topology
          </h1>
          <p className="text-xs text-slate-500">
            Devices are shown without links until verified adjacency evidence is available.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-mono font-bold text-sky-700 shadow-2xs">
            <Zap className="w-3.5 h-3.5" />
            <span>{devicesCount} Devices · links unverified</span>
          </div>
          <button 
            onClick={fetchTopology}
            className="p-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-slate-900 transition-colors cursor-pointer shadow-2xs"
            title="Recalculate Map"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ReactFlow Interactive Canvas */}
      <div className="flex-1 glass-card-static rounded-2xl border border-slate-200 overflow-hidden relative shadow-sm">
        <ReactFlow
          nodes={nodes}
          edges={[]}
          onNodesChange={onNodesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          className="bg-slate-50/70"
        >
          <Background color="#cbd5e1" gap={24} size={1} />
          <Controls className="bg-white border-slate-200 text-slate-700 fill-slate-700 rounded-xl overflow-hidden shadow-md m-4" />
        </ReactFlow>
      </div>

    </div>
  );
};

export default NetworkMap;
