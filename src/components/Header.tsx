import React from 'react';
import {
  PrinterModel,
  PRINTER_SPECS,
  MachineExecutionState,
  PenOffset,
} from '../types/plotter';
import {
  Play,
  Pause,
  Download,
  Wifi,
  Cpu,
  Wrench,
  Layers,
  Sparkles
} from 'lucide-react';

interface HeaderProps {
  printerModel: PrinterModel;
  onModelChange: (model: PrinterModel) => void;
  connectionMode: 'mqtt' | 'simulator';
  machineState: MachineExecutionState;
  onOpenSetupWizard: () => void;
  onOpenConnectionModal: () => void;
  onExportGcode: () => void;
  onStartPlot: () => void;
  isReadyToPlot: boolean;
  elementCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  printerModel,
  onModelChange,
  connectionMode,
  machineState,
  onOpenSetupWizard,
  onOpenConnectionModal,
  onExportGcode,
  onStartPlot,
  isReadyToPlot,
  elementCount,
}) => {
  const isPlotting = machineState === 'plotting';
  const isPaused = machineState === 'paused';
  const isBusy = isPlotting || isPaused || machineState === 'homing' || machineState === 'leveling';

  return (
    <header className="h-14 bg-[#0d1017] border-b border-[#1e2536] px-6 flex items-center justify-between gap-8 shrink-0 select-none z-30">
      {/* Zone 1: Single-element Brand Wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <a href="/" className="text-base font-extrabold tracking-tight text-white whitespace-nowrap flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 transform rotate-45 inline-block" />
          <span>Bambu Plotter Studio</span>
        </a>
      </div>

      {/* Zone 2: 4–5 Clean Single-Line Nav Links & Mode Triggers */}
      <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
        <button
          onClick={onOpenSetupWizard}
          className="hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
        >
          <Wrench className="w-3.5 h-3.5 text-emerald-400" />
          <span>Setup Wizard</span>
        </button>

        <button
          onClick={onOpenConnectionModal}
          className="hover:text-emerald-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
        >
          {connectionMode === 'simulator' ? (
            <>
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              <span>Virtual Engine</span>
            </>
          ) : (
            <>
              <Wifi className="w-3.5 h-3.5 text-cyan-400" />
              <span>Bambu LAN Link</span>
            </>
          )}
        </button>

        <button
          onClick={onExportGcode}
          disabled={elementCount === 0}
          className="hover:text-emerald-400 disabled:opacity-40 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-slate-400" />
          <span>Export G-Code</span>
        </button>

        <div className="flex items-center gap-1 text-[11px] font-mono text-slate-400 whitespace-nowrap shrink-0">
          <span>Bed:</span>
          <span className="text-slate-200 font-bold">
            {printerModel === 'A1_MINI' ? '180×180mm' : '256×256mm'}
          </span>
        </div>
      </nav>

      {/* Zone 3: 1 Primary Action CTA */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onStartPlot}
          disabled={!isReadyToPlot && !isBusy}
          className={`px-5 py-2 text-xs font-bold rounded-lg flex items-center gap-2 transition-all whitespace-nowrap shrink-0 shadow-lg ${
            isBusy
              ? 'bg-amber-600 text-white shadow-amber-950/40'
              : !isReadyToPlot
              ? 'bg-[#1b2230] text-slate-500 cursor-not-allowed border border-[#263145]'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/50 cursor-pointer'
          }`}
        >
          {isPlotting ? (
            <>
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span>Plotting in Progress...</span>
            </>
          ) : isPaused ? (
            <>
              <Pause className="w-3.5 h-3.5" />
              <span>Plot Paused</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Plot ({elementCount} items)</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};
