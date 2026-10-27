import React from 'react';
import { ActiveTool } from '../types/plotter';
import {
  MousePointer,
  Type,
  Square,
  Circle,
  Slash,
  Upload,
  Wrench,
  Wifi,
  Cpu
} from 'lucide-react';

interface VectorToolbarProps {
  activeTool: ActiveTool;
  onSelectTool: (tool: ActiveTool) => void;
  onUploadSvg: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenSetupWizard: () => void;
  onOpenConnectionModal: () => void;
  connectionMode: 'mqtt' | 'simulator';
}

export const VectorToolbar: React.FC<VectorToolbarProps> = ({
  activeTool,
  onSelectTool,
  onUploadSvg,
  onOpenSetupWizard,
  onOpenConnectionModal,
  connectionMode,
}) => {
  return (
    <div className="w-12 bg-[#0c0f16] border-r border-[#1e2536] flex flex-col items-center py-3 gap-2 shrink-0 select-none z-20">
      {/* Primary Vector Creation Tools */}
      <div className="space-y-1 w-full px-1.5">
        <button
          onClick={() => onSelectTool('select')}
          className={`w-full h-9 rounded-lg flex items-center justify-center transition-all ${
            activeTool === 'select'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
              : 'text-slate-400 hover:text-white hover:bg-[#18202d]'
          }`}
          title="Select Tool (V) - Move and resize objects"
        >
          <MousePointer className="w-4 h-4" />
        </button>

        <button
          onClick={() => onSelectTool('text')}
          className={`w-full h-9 rounded-lg flex items-center justify-center transition-all ${
            activeTool === 'text'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
              : 'text-slate-400 hover:text-white hover:bg-[#18202d]'
          }`}
          title="Text Tool (T) - Click bed to add typography"
        >
          <Type className="w-4 h-4" />
        </button>

        <button
          onClick={() => onSelectTool('rect')}
          className={`w-full h-9 rounded-lg flex items-center justify-center transition-all ${
            activeTool === 'rect'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
              : 'text-slate-400 hover:text-white hover:bg-[#18202d]'
          }`}
          title="Rectangle Tool (R) - Click & drag to draw rectangle"
        >
          <Square className="w-4 h-4" />
        </button>

        <button
          onClick={() => onSelectTool('circle')}
          className={`w-full h-9 rounded-lg flex items-center justify-center transition-all ${
            activeTool === 'circle'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
              : 'text-slate-400 hover:text-white hover:bg-[#18202d]'
          }`}
          title="Circle Tool (C) - Click & drag to draw circle"
        >
          <Circle className="w-4 h-4" />
        </button>

        <button
          onClick={() => onSelectTool('line')}
          className={`w-full h-9 rounded-lg flex items-center justify-center transition-all ${
            activeTool === 'line'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950/50'
              : 'text-slate-400 hover:text-white hover:bg-[#18202d]'
          }`}
          title="Line Tool (L) - Click & drag to draw vector line"
        >
          <Slash className="w-4 h-4" />
        </button>
      </div>

      <div className="w-6 h-px bg-[#1e2536] my-1" />

      {/* SVG File Upload Tool */}
      <label
        className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#18202d] cursor-pointer transition-colors"
        title="Import SVG File (I)"
      >
        <Upload className="w-4 h-4" />
        <input
          type="file"
          accept=".svg,image/svg+xml"
          onChange={onUploadSvg}
          className="hidden"
        />
      </label>

      {/* Spacer */}
      <div className="flex-1" />

      <div className="w-6 h-px bg-[#1e2536] my-1" />

      {/* Setup & Connection quick buttons */}
      <button
        onClick={onOpenSetupWizard}
        className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-emerald-400 hover:bg-[#18202d] transition-colors"
        title="Hardware Setup Wizard"
      >
        <Wrench className="w-4 h-4" />
      </button>

      <button
        onClick={onOpenConnectionModal}
        className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-cyan-400 hover:bg-[#18202d] transition-colors"
        title="Machine Connection Status"
      >
        {connectionMode === 'simulator' ? (
          <Cpu className="w-4 h-4 text-emerald-400" />
        ) : (
          <Wifi className="w-4 h-4 text-cyan-400" />
        )}
      </button>
    </div>
  );
};
