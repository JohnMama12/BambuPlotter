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
  RefreshCw
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

  const handleJog = (axis: 'x' | 'y', dir: number) => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected! Please open "Bambu Printer Link" and click "Verify & Connect" first.');
      return;
    }
    bambuMachine.jog(axis, dir * jogStep);
  };

  const handleHomeAll = () => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected! Please open "Bambu Printer Link" and click "Verify & Connect" first.');
      return;
    }
    bambuMachine.homeAll();
  };

  const handleRefreshPosition = () => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected via MQTT.');
      return;
    }
    const pos = telemetry.hotendPos;
    bambuMachine.sendRawGcode(`G0 X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)} Z${pos.z.toFixed(3)}`);
  };

  const handleCaptureBedReference = () => {
    const result = bambuMachine.captureBedReference();
    if (!result.success) {
      alert(result.error || 'Could not capture the bed reference.');
    }
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

  return (
    <div className="w-[320px] h-full bg-[#10141d] border-l border-[#1e2536] flex flex-col shrink-0 select-none">
      {/* Header status bar */}
      <div className="p-4 border-b border-[#1e2536] bg-[#0c0f16]">
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
            <span className="text-slate-300 font-semibold">{telemetry.progressPercent}% Completed</span>
            <span className="text-slate-400">
              {telemetry.currentStrokeIndex} / {telemetry.totalStrokes} paths
            </span>
          </div>
          <div className="w-full h-2 bg-[#090b10] rounded-full overflow-hidden border border-[#1e2536]">
            <div
              style={{ width: `${telemetry.progressPercent}%` }}
              className="h-full bg-emerald-500 transition-all duration-200"
            />
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-0.5">
            <span>Elapsed: {formatSeconds(telemetry.elapsedSeconds)}</span>
            <span>Remaining: ~{formatSeconds(telemetry.remainingSeconds)}</span>
          </div>
        </div>
      </div>

      {/* Main Drawer Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Active Pen Indicator */}
        {telemetry.currentPen && (
          <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className="w-4 h-4 rounded-full border border-white/20 shadow-sm"
                style={{ backgroundColor: telemetry.currentPen.hex }}
              />
              <div>
                <div className="text-xs font-semibold text-white">{telemetry.currentPen.name}</div>
                <div className="text-[10px] font-mono text-slate-400">
                  Tip {telemetry.currentPen.diameter}mm · Slot {telemetry.currentPenIndex + 1}
                </div>
              </div>
            </div>
            {telemetry.state === 'plotting' && (
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                Drawing
              </span>
            )}
          </div>
        )}

        {/* Live Coordinate Matrix (Dual Tracking: Nozzle vs Pen) */}
        <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
              Live Coordinate Tracking
            </span>
            <span className="text-[10px] font-mono text-cyan-400">
              Offset: X:{penOffset.x} Y:{penOffset.y}mm
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            {/* Pen Coordinates */}
            <div className="p-2 rounded bg-[#131924] border border-[#232f45]">
              <span className="text-[10px] uppercase text-cyan-400 block font-bold">Pen Tip</span>
              <div className="mt-1 space-y-0.5 text-slate-200">
                <div>X: <span className="font-bold text-white">{telemetry.penPos.x.toFixed(2)}</span> mm</div>
                <div>Y: <span className="font-bold text-white">{telemetry.penPos.y.toFixed(2)}</span> mm</div>
                <div>Z: <span className="font-bold text-white">{telemetry.penPos.z.toFixed(2)}</span> mm</div>
              </div>
            </div>

            {/* Hotend Toolhead Coordinates */}
            <div className="p-2 rounded bg-[#131924] border border-[#232f45]">
              <span className="text-[10px] uppercase text-slate-400 block font-bold">Hotend (Nozzle)</span>
              <div className="mt-1 space-y-0.5 text-slate-300">
                <div>X: {telemetry.hotendPos.x.toFixed(2)} mm</div>
                <div>Y: {telemetry.hotendPos.y.toFixed(2)} mm</div>
                <div>Z: {telemetry.hotendPos.z.toFixed(2)} mm</div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-[10px] font-mono border-t border-[#1e2536]">
            <span className="text-slate-500">
              Bed {zBed.toFixed(2)} · Draw {zDraw.toFixed(2)} · Travel {zTravel.toFixed(2)} mm
            </span>
            <span className="text-emerald-400">Bed + 1 mm</span>
          </div>
        </div>
        <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Bed Slinger Jog Controls
              </span>
              <span className="text-[10px] text-slate-400">
                Y moves Bed slinger · X moves Toolhead
              </span>
            </div>
            <div className="flex gap-1">
              {[0.1, 1, 10, 50].map((step) => (
                <button
                  key={step}
                  onClick={() => setJogStep(step)}
                  className={`px-1.5 py-0.5 text-[9px] font-mono rounded ${
                    jogStep === step
                      ? 'bg-emerald-600 text-white font-bold'
                      : 'bg-[#1b2333] text-slate-400 hover:text-white'
                  }`}
                >
                  {step}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 w-48 mx-auto text-center">
            <div />
            <button
              onClick={() => handleJog('y', 1)}
              className="p-2 bg-[#171f2d] hover:bg-[#222d42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a]"
              title="Bed Slides Backward (+Y coordinate)"
            >
              <ArrowUp className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">+Y Bed</span>
            </button>
            <div />

            <button
              onClick={() => handleJog('x', -1)}
              className="p-2 bg-[#171f2d] hover:bg-[#222d42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a]"
              title="Toolhead Moves Left (-X)"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">-X Head</span>
            </button>
            <button
              onClick={handleHomeAll}
              className="p-2 bg-emerald-800/80 hover:bg-emerald-700 text-white rounded font-mono text-[10px] font-bold flex flex-col items-center justify-center transition-colors"
              title="Home All (G28)"
            >
              <span>G28</span>
              <span className="text-[8px] text-emerald-200">Home</span>
            </button>
            <button
              onClick={() => handleJog('x', 1)}
              className="p-2 bg-[#171f2d] hover:bg-[#222d42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a]"
              title="Toolhead Moves Right (+X)"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">+X Head</span>
            </button>

            <div />
            <button
              onClick={() => handleJog('y', -1)}
              className="p-2 bg-[#171f2d] hover:bg-[#222d42] text-white rounded font-mono text-[11px] flex flex-col items-center justify-center transition-colors border border-[#26334a]"
              title="Bed Slides Forward Toward User (-Y coordinate)"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span className="text-[8px] text-slate-400">-Y Bed</span>
            </button>
            <div />
            <div />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={handleCaptureBedReference}
              className="w-full py-1.5 px-2 bg-emerald-700/80 hover:bg-emerald-600 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5"
              title="Store the current Z as the physical bed reference. No motion."
            >
              <Crosshair className="w-3 h-3" />
              <span>Capture Bed Reference</span>
            </button>
            <button
              onClick={handleRefreshPosition}
              className="w-full py-1.5 px-2 bg-[#141b26] hover:bg-[#1e2736] text-xs font-mono text-cyan-300 rounded border border-cyan-500/30 flex items-center justify-center gap-1.5"
              title="Request fresh position from printer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Position</span>
            </button>
          </div>
        </div>

        {/* Environmental Telemetry */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-[#0d1017] border border-[#222b3a] flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-slate-400" />
            <div>
              <span className="text-[10px] text-slate-400 uppercase font-mono block">Nozzle Temp</span>
              <span className="text-xs font-mono font-bold text-slate-200">{telemetry.hotendTemp}°C (Cold)</span>
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-[#0d1017] border border-[#222b3a] flex items-center gap-2">
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
          <div className="h-28 bg-[#090b10] border border-[#1e2536] rounded-lg p-2 font-mono text-[10px] text-slate-400 overflow-y-auto space-y-1 select-text">
            {telemetry.logMessages.map((msg, idx) => (
              <div key={idx} className="leading-tight">
                {msg}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Primary Execution Controls Footer */}
      <div className="p-4 border-t border-[#1e2536] bg-[#0c0f16] flex items-center gap-2">
        {telemetry.state === 'plotting' && (
          <button
            onClick={onPause}
            className="flex-1 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-amber-950/40"
          >
            <Pause className="w-3.5 h-3.5" />
            <span>Pause Plot</span>
          </button>
        )}

        {telemetry.state === 'paused' && (
          <button
            onClick={onResume}
            className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-emerald-950/40"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Resume</span>
          </button>
        )}

        {(telemetry.state === 'plotting' || telemetry.state === 'paused' || telemetry.state === 'waiting_pen_change') && (
          <button
            onClick={onEmergencyStop}
            className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-rose-950/40"
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
