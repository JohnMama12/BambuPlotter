import React, { useState } from 'react';
import {
  MachineTelemetry,
  PrinterModel,
  PRINTER_SPECS,
  PenOffset,
} from '../types/plotter';
import { bambuMachine } from '../services/bambuService';
import { getBedReference, getDrawZ, getTravelZ } from '../utils/zSafety';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  Thermometer,
  Terminal,
  Crosshair,
  Compass,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  RefreshCw,
  Cpu,
  Layers,
  Activity,
  CheckCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';

interface TelemetryDrawerProps {
  telemetry: MachineTelemetry;
  printerModel: PrinterModel;
  penOffset: PenOffset;
  onEmergencyStop: () => void;
  onPause: () => void;
  onResume: () => void;
}

export const TelemetryDrawer: React.FC<TelemetryDrawerProps> = ({
  telemetry,
  printerModel,
  penOffset,
  onEmergencyStop,
  onPause,
  onResume,
}) => {
  const [jogStep, setJogStep] = useState<number>(10);
  const spec = PRINTER_SPECS[printerModel];
  const buffer = telemetry.bufferQueue;

  const [showHomingModal, setShowHomingModal] = useState<boolean>(false);
  const [isLifting, setIsLifting] = useState<boolean>(false);

  const handleJog = (axis: 'x' | 'y', dir: number) => {
    bambuMachine.jog(axis, dir * jogStep);
  };

  const handleTriggerEmergencyLift = async () => {
    setIsLifting(true);
    await bambuMachine.emergencyLiftPen();
    setIsLifting(false);
  };

  const handleConfirmHomeAll = async () => {
    setShowHomingModal(false);
    await bambuMachine.safeHomeNoPen();
  };

  const zBed = getBedReference(bambuMachine.getZCalibration());
  const zDraw = getDrawZ(bambuMachine.getZCalibration());
  const zTravel = getTravelZ(bambuMachine.getZCalibration());

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStatusColor = (state: string) => {
    switch (state) {
      case 'plotting':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'waiting_pen_change':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30 animate-pulse';
      case 'paused':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'homing':
      case 'leveling':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      case 'completed':
        return 'text-emerald-300 bg-emerald-500/20 border-emerald-400';
      case 'aborted':
      case 'error':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      default:
        return 'text-slate-400 bg-slate-800/50 border-slate-700/50';
    }
  };

  const getBufferHealthColor = (health: string) => {
    switch (health) {
      case 'streaming':
        return 'text-emerald-400 bg-emerald-950/40 border-emerald-800/50';
      case 'syncing':
        return 'text-amber-400 bg-amber-950/40 border-amber-800/50 animate-pulse';
      case 'paused':
        return 'text-yellow-400 bg-yellow-950/40 border-yellow-800/50';
      case 'error':
        return 'text-rose-400 bg-rose-950/40 border-rose-800/50';
      default:
        return 'text-slate-400 bg-slate-800/40 border-slate-700/50';
    }
  };

  return (
    <div className="w-[340px] h-full bg-[#0e121a] border-l border-[#1f2838] flex flex-col shrink-0 select-none">
      {/* Header status bar */}
      <div className="p-4 border-b border-[#1f2838] bg-[#090c12]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
            Real-Time Machine Telemetry
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold border ${getStatusColor(
              telemetry.state
            )}`}
          >
            {telemetry.state.replace('_', ' ')}
          </span>
        </div>

        {/* Progress Display */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-200 font-bold">{telemetry.progressPercent}% Completed</span>
            <span className="text-slate-400">
              {telemetry.currentStrokeIndex} / {telemetry.totalStrokes} paths
            </span>
          </div>
          <div className="w-full h-2 bg-[#06080c] rounded-full overflow-hidden border border-[#1e2536]">
            <div
              style={{ width: `${telemetry.progressPercent}%` }}
              className="h-full bg-emerald-500 transition-all duration-200 shadow-sm shadow-emerald-500/50"
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
            <span>Elapsed: {formatSeconds(telemetry.elapsedSeconds)}</span>
            <span>ETA: ~{formatSeconds(telemetry.remainingSeconds)}</span>
          </div>
        </div>
      </div>

      {/* Main Drawer Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Strict Command Buffer Inspector */}
        <div className="p-3 rounded-lg bg-[#121722] border border-[#20293a] space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>Command Buffer Queue</span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase font-bold border ${getBufferHealthColor(
                buffer?.bufferHealth || 'idle'
              )}`}
            >
              {buffer?.bufferHealth === 'syncing' ? 'M400 Syncing' : buffer?.bufferHealth || 'Idle'}
            </span>
          </div>

          {/* Buffer Metrics Grid */}
          <div className="grid grid-cols-3 gap-1.5 text-center font-mono">
            <div className="p-1.5 bg-[#0a0d14] rounded border border-[#1c2434]">
              <span className="text-[9px] text-slate-500 block">EXECUTED</span>
              <span className="text-xs font-bold text-emerald-400 tabular-nums">
                {buffer?.acknowledgedCommands ?? 0}
              </span>
            </div>
            <div className="p-1.5 bg-[#0a0d14] rounded border border-[#1c2434]">
              <span className="text-[9px] text-slate-500 block">DISPATCHED</span>
              <span className="text-xs font-bold text-cyan-400 tabular-nums">
                {buffer?.sentCommands ?? 0}
              </span>
            </div>
            <div className="p-1.5 bg-[#0a0d14] rounded border border-[#1c2434]">
              <span className="text-[9px] text-slate-500 block">TOTAL MOVES</span>
              <span className="text-xs font-bold text-slate-300 tabular-nums">
                {buffer?.totalCommands ?? 0}
              </span>
            </div>
          </div>

          {/* Active G-code batch string */}
          {buffer?.activeBatchGcode && (
            <div className="p-2 bg-[#07090f] rounded border border-[#1a2130] font-mono text-[10px] text-slate-400 truncate">
              <span className="text-cyan-400 mr-1.5 font-bold">BATCH {buffer.activeChunkIndex}/{buffer.totalChunks}:</span>
              <span>{buffer.activeBatchGcode}</span>
            </div>
          )}
        </div>

        {/* Active Pen Indicator */}
        {telemetry.currentPen && (
          <div className="p-3 rounded-lg bg-[#121722] border border-[#20293a] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-4 h-4 rounded-full border border-white/20 shadow-xs"
                style={{ backgroundColor: telemetry.currentPen.hex }}
              />
              <div>
                <span className="text-[10px] text-slate-400 font-mono block">ACTIVE COLOR</span>
                <span className="text-xs font-semibold text-white">{telemetry.currentPen.name}</span>
              </div>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              {telemetry.currentPen.diameter}mm tip
            </span>
          </div>
        )}

        {/* Coordinates HUD */}
        <div className="p-3 rounded-lg bg-[#121722] border border-[#20293a] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
              Hotend / Pen Coordinates
            </span>
            <span className="text-[10px] font-mono text-emerald-400">G90 Mode</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center font-mono">
            <div className="p-2 bg-[#090c13] rounded border border-[#1c2434]">
              <span className="text-[9px] text-slate-500 block">X</span>
              <span className="text-xs font-bold text-slate-200 tabular-nums">
                {telemetry.hotendPos.x.toFixed(1)}
              </span>
            </div>
            <div className="p-2 bg-[#090c13] rounded border border-[#1c2434]">
              <span className="text-[9px] text-slate-500 block">Y</span>
              <span className="text-xs font-bold text-slate-200 tabular-nums">
                {telemetry.hotendPos.y.toFixed(1)}
              </span>
            </div>
            <div className="p-2 bg-[#090c13] rounded border border-[#1c2434]">
              <span className="text-[9px] text-slate-500 block">Z</span>
              <span className="text-xs font-bold text-emerald-400 tabular-nums">
                {telemetry.hotendPos.z.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Jog Controls */}
        <div className="p-3 rounded-lg bg-[#121722] border border-[#20293a] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400">
              Manual Motion Control
            </span>
            <div className="flex items-center gap-1">
              {[1, 10, 50].map((step) => (
                <button
                  key={step}
                  onClick={() => setJogStep(step)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer ${
                    jogStep === step
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-[#18202e] text-slate-400 hover:text-white'
                  }`}
                >
                  {step}mm
                </button>
              ))}
            </div>
          </div>

          {/* D-Pad */}
          <div className="grid grid-cols-3 gap-1.5 w-44 mx-auto py-1">
            <div />
            <button
              onClick={() => handleJog('y', 1)}
              className="p-2 bg-[#171f2d] hover:bg-[#232e42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a] cursor-pointer"
              title="Bed Slides Back (+Y coordinate)"
            >
              <ArrowUp className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">+Y Bed</span>
            </button>
            <div />

            <button
              onClick={() => handleJog('x', -1)}
              className="p-2 bg-[#171f2d] hover:bg-[#232e42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a] cursor-pointer"
              title="Toolhead Moves Left (-X)"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">-X Head</span>
            </button>
            <button
              onClick={() => setShowHomingModal(true)}
              className="p-2 bg-emerald-800/80 hover:bg-emerald-700 text-white rounded font-mono text-[10px] font-bold flex flex-col items-center justify-center transition-colors cursor-pointer"
              title="Safe Home All (G28) - Requires Pen Removed"
            >
              <span>G28</span>
              <span className="text-[8px] text-emerald-200">Home</span>
            </button>
            <button
              onClick={() => handleJog('x', 1)}
              className="p-2 bg-[#171f2d] hover:bg-[#232e42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a] cursor-pointer"
              title="Toolhead Moves Right (+X)"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">+X Head</span>
            </button>

            <div />
            <button
              onClick={() => handleJog('y', -1)}
              className="p-2 bg-[#171f2d] hover:bg-[#232e42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a] cursor-pointer"
              title="Bed Slides Forward (-Y coordinate)"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">-Y Bed</span>
            </button>
            <div />
          </div>

          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <button
              onClick={handleTriggerEmergencyLift}
              disabled={isLifting}
              className="py-1.5 px-2 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 text-[11px] font-mono rounded border border-amber-500/40 flex items-center justify-center gap-1 cursor-pointer transition-colors"
              title="Immediately lift pen tip 10mm above paper to stop bleeding"
            >
              <ArrowUp className="w-3 h-3 text-amber-400" />
              <span>Lift Pen (+10mm)</span>
            </button>

            <button
              onClick={() => setShowHomingModal(true)}
              className="py-1.5 px-2 bg-[#141b26] hover:bg-[#1e2736] text-[11px] font-mono text-cyan-300 rounded border border-cyan-500/30 flex items-center justify-center gap-1 cursor-pointer transition-colors"
              title="Home printer safely (requires pen to be removed)"
            >
              <Crosshair className="w-3 h-3 text-cyan-400" />
              <span>Safe Home (G28)</span>
            </button>
          </div>
        </div>

        {/* Homing Safety Confirmation Modal */}
        {showHomingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-[#121620] border border-rose-500/50 rounded-xl max-w-sm w-full p-5 space-y-3 shadow-2xl">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>Verify Pen is Removed!</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Bambu A1 printers probe the nozzle directly against the bed plate during homing. If a pen is mounted, <strong>it will crash into the bed and damage the mount or bed sheet</strong>.
              </p>
              <div className="p-2.5 rounded bg-rose-950/30 border border-rose-900/40 text-[11px] text-rose-200">
                Please remove the pen or ensure the clamp is completely empty before proceeding.
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowHomingModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmHomeAll}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold shadow-md"
                >
                  Pen Removed, Run Home
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Environmental Telemetry */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-[#121722] border border-[#20293a] flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-slate-400" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-mono block">Nozzle Temp</span>
              <span className="text-xs font-mono font-bold text-slate-200">{telemetry.hotendTemp}°C (Cold)</span>
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[#121722] border border-[#20293a] flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-slate-400" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-mono block">Bed Temp</span>
              <span className="text-xs font-mono font-bold text-slate-200">{telemetry.bedTemp}°C (Off)</span>
            </div>
          </div>
        </div>

        {/* Terminal Activity Log Stream */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 uppercase tracking-wider">
            <Terminal className="w-3.5 h-3.5 text-slate-400" />
            <span>Activity Log</span>
          </div>
          <div className="h-28 bg-[#07090f] border border-[#1b2333] rounded-lg p-2 font-mono text-[10px] text-slate-400 overflow-y-auto space-y-1 select-text">
            {telemetry.logMessages.map((msg, idx) => (
              <div key={idx} className="leading-tight">
                {msg}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Primary Execution Controls Footer */}
      <div className="p-4 border-t border-[#1f2838] bg-[#090c12] flex items-center gap-2">
        {telemetry.state === 'plotting' && (
          <button
            onClick={onPause}
            className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-amber-950/40 cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>Pause Plot</span>
          </button>
        )}

        {telemetry.state === 'paused' && (
          <button
            onClick={onResume}
            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-emerald-950/40 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Resume</span>
          </button>
        )}

        {(telemetry.state === 'plotting' || telemetry.state === 'paused' || telemetry.state === 'waiting_pen_change') && (
          <button
            onClick={onEmergencyStop}
            className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-rose-950/40 cursor-pointer"
            title="Emergency Abort"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Abort</span>
          </button>
        )}
      </div>
    </div>
  );
};
