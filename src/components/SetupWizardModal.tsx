import React, { useState } from 'react';
import {
  Check,
  ChevronRight,
  ChevronLeft,
  X,
  Crosshair,
  Layers,
  ArrowDown,
  RotateCcw,
  Sparkles,
  HelpCircle,
  AlertTriangle,
  Move,
  Play,
  ShieldCheck,
  Sliders
} from 'lucide-react';
import {
  PaperBounds,
  Point2D,
  ZCalibration,
  PenOffset,
  PrinterModel,
  PRINTER_SPECS,
} from '../types/plotter';
import { bambuMachine } from '../services/bambuService';
import {
  Z_SAFETY,
  clampPenRelease,
  getDrawZ,
  getTravelZ,
} from '../utils/zSafety';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  printerModel: PrinterModel;
  penOffset: PenOffset;
  zCalibration: ZCalibration;
  paperBounds: PaperBounds;
  onSaveZCalibration: (zCal: ZCalibration) => void;
  onSavePaperBounds: (bounds: PaperBounds) => void;
  onClearCalibration: () => void;
  currentPenPos: { x: number; y: number; z: number };
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({
  isOpen,
  onClose,
  printerModel,
  penOffset,
  zCalibration,
  paperBounds,
  onSaveZCalibration,
  onSavePaperBounds,
  onClearCalibration,
  currentPenPos,
}) => {
  const [step, setStep] = useState<number>(1);
  const [travelLiftVal, setTravelLiftVal] = useState<number>(
    clampPenRelease(zCalibration.penReleaseMm) || 3.5
  );
  const [jogStep, setJogStep] = useState<number>(10);
  const [actionStatus, setActionStatus] = useState<{ type: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // 4 corners mapping state
  const [tl, setTl] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.topLeft : null);
  const [tr, setTr] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.topRight : null);
  const [bl, setBl] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.bottomLeft : null);
  const [br, setBr] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.bottomRight : null);

  if (!isOpen) return null;

  const spec = PRINTER_SPECS[printerModel];
  const telemetry = bambuMachine.getTelemetry();
  const isMqtt = telemetry.isConnected && telemetry.connectionMode === 'mqtt';

  const showStatus = (type: 'info' | 'success' | 'error', message: string) => {
    setActionStatus({ type, message });
    if (type === 'success' || type === 'info') {
      setTimeout(() => setActionStatus(null), 4000);
    }
  };

  const [hoverHeightVal, setHoverHeightVal] = useState<number>(
    zCalibration.hoverZMm || 25.0
  );

  // Step 2: Safe Homing
  const handleSafeHome = async () => {
    setIsProcessing(true);
    setActionStatus({ type: 'info', message: 'Homing printer without pen... Nozzle touching bare bed to set machine endstops.' });
    const res = await bambuMachine.safeHomeNoPen();
    setIsProcessing(false);
    if (res.success) {
      showStatus('success', 'Homing complete! Toolhead lifted safely to Z=30mm.');
    } else {
      showStatus('error', res.error || 'Homing failed. Check connection.');
    }
  };

  const handleMoveToHoverStation = async () => {
    setIsProcessing(true);
    setActionStatus({ type: 'info', message: `Moving to Floating Hover Station (Z=${hoverHeightVal}mm) & disabling ABL mesh compensation...` });
    const res = await bambuMachine.prepareHoverStation(hoverHeightVal);
    setIsProcessing(false);
    if (res.success) {
      showStatus('success', `Toolhead parked at floating hover height (Z=${hoverHeightVal}mm). Mesh leveling disabled. Ready to gently drop pen.`);
    } else {
      showStatus('error', res.error || 'Move failed.');
    }
  };

  const handleLockPaperZero = async () => {
    setIsProcessing(true);
    setActionStatus({ type: 'info', message: 'Flushing queue and locking Paper Zero (M400 -> G92 Z0 -> M400)...' });
    const res = await bambuMachine.lockPaperZeroG92(travelLiftVal);
    setIsProcessing(false);
    if (res.success) {
      showStatus('success', `Paper Zero established! Toolhead lifted to travel plane (Z=${travelLiftVal.toFixed(1)}mm). Nozzle remains floating ${hoverHeightVal}mm high.`);
      onSaveZCalibration({
        ...zCalibration,
        isCalibrated: true,
        datumSource: 'pen_drop',
        paperZeroSet: true,
        hoverZMm: hoverHeightVal,
        penReleaseMm: travelLiftVal,
      });
    } else {
      showStatus('error', res.error || 'Failed to lock paper zero.');
    }
  };

  const handleTestLiftDrop = async () => {
    setIsProcessing(true);
    // Lower to draw (Z=0), wait, lift to travel (Z=travelLiftVal)
    await bambuMachine.sendRawGcode(`G0 Z0 F1200\n`);
    await new Promise((r) => setTimeout(r, 600));
    await bambuMachine.sendRawGcode(`G0 Z${travelLiftVal.toFixed(2)} F1800\n`);
    setIsProcessing(false);
    showStatus('info', `Test move executed: Plunged to Z=0 (paper contact) and lifted to Z=${travelLiftVal.toFixed(1)}mm.`);
  };

  // Step 4: Boundary Presets
  const applyPresetBounds = (type: 'A4' | 'A5' | 'A6' | 'SQUARE' | 'FULL') => {
    let w = 140;
    let h = 140;
    if (type === 'A4') {
      // Fit A4 landscape or portrait to bed
      w = Math.min(spec.width - 20, 160);
      h = Math.min(spec.depth - 20, 200);
    } else if (type === 'A5') {
      w = 148;
      h = Math.min(spec.depth - 20, 160);
    } else if (type === 'A6') {
      w = 105;
      h = 148;
    } else if (type === 'SQUARE') {
      w = Math.min(spec.width - 25, 140);
      h = w;
    } else if (type === 'FULL') {
      w = spec.width - 20;
      h = spec.depth - 20;
    }

    const startX = Math.round((spec.width - w) / 2);
    const startY = Math.round((spec.depth - h) / 2);

    const presetBounds: PaperBounds = {
      isCalibrated: true,
      paperType: type,
      bottomLeft: { x: startX, y: startY },
      bottomRight: { x: startX + w, y: startY },
      topLeft: { x: startX, y: startY + h },
      topRight: { x: startX + w, y: startY + h },
      widthMm: w,
      heightMm: h,
    };

    setBl(presetBounds.bottomLeft);
    setBr(presetBounds.bottomRight);
    setTl(presetBounds.topLeft);
    setTr(presetBounds.topRight);
    onSavePaperBounds(presetBounds);
    showStatus('success', `Applied ${type} preset: ${w} × ${h} mm.`);
  };

  const handleJog = (axis: 'x' | 'y', dir: number) => {
    bambuMachine.jog(axis, dir * jogStep);
  };

  const recordCorner = (corner: 'tl' | 'tr' | 'bl' | 'br') => {
    const pt = { x: Math.round(currentPenPos.x * 10) / 10, y: Math.round(currentPenPos.y * 10) / 10 };
    if (corner === 'tl') setTl(pt);
    if (corner === 'tr') setTr(pt);
    if (corner === 'bl') setBl(pt);
    if (corner === 'br') setBr(pt);
    showStatus('info', `Recorded ${corner.toUpperCase()} at (${pt.x}, ${pt.y}) mm`);
  };

  const handleFinishWizard = () => {
    const p1 = tl || { x: 20, y: spec.depth - 20 };
    const p2 = tr || { x: spec.width - 20, y: spec.depth - 20 };
    const p3 = bl || { x: 20, y: 20 };
    const p4 = br || { x: spec.width - 20, y: 20 };

    const minX = Math.min(p1.x, p3.x);
    const maxX = Math.max(p2.x, p4.x);
    const minY = Math.min(p3.y, p4.y);
    const maxY = Math.max(p1.y, p2.y);

    const calculatedBounds: PaperBounds = {
      isCalibrated: true,
      topLeft: p1,
      topRight: p2,
      bottomLeft: p3,
      bottomRight: p4,
      widthMm: Math.round((maxX - minX) * 10) / 10,
      heightMm: Math.round((maxY - minY) * 10) / 10,
    };

    onSavePaperBounds(calculatedBounds);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-[#10141d] border border-[#222b3d] rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1f2838] flex items-center justify-between bg-[#0b0e14]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                {spec.name}
              </span>
              <span className="text-slate-600 text-xs">·</span>
              <span className="text-xs text-slate-400">Zero-Collision Calibration Wizard</span>
            </div>
            <h2 className="text-base font-bold text-white mt-0.5">Pen Height Datum & Bed Alignment</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-3 bg-[#0d1017] border-b border-[#1c2434] flex items-center justify-between text-xs">
          {[
            { num: 1, label: '1. Tape Paper' },
            { num: 2, label: '2. Safe Home' },
            { num: 3, label: '3. Seat Pen (G92)' },
            { num: 4, label: '4. Paper Boundaries' },
          ].map((item) => (
            <div
              key={item.num}
              className={`flex items-center gap-2 font-medium ${
                step === item.num
                  ? 'text-emerald-400'
                  : step > item.num
                  ? 'text-slate-300'
                  : 'text-slate-500'
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold ${
                  step === item.num
                    ? 'bg-emerald-500/20 border border-emerald-500 text-emerald-300'
                    : step > item.num
                    ? 'bg-emerald-950/60 border border-emerald-600 text-emerald-400'
                    : 'bg-[#181f2c] border border-[#2a3447] text-slate-500'
                }`}
              >
                {step > item.num ? <Check className="w-3.5 h-3.5" /> : item.num}
              </div>
              <span className="hidden sm:inline">{item.label}</span>
            </div>
          ))}
        </div>

        {/* Inline Status Banner */}
        {actionStatus && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center gap-2 border-b ${
              actionStatus.type === 'error'
                ? 'bg-rose-950/40 text-rose-300 border-rose-900/50'
                : actionStatus.type === 'success'
                ? 'bg-emerald-950/40 text-emerald-300 border-emerald-900/50'
                : 'bg-cyan-950/40 text-cyan-300 border-cyan-900/50'
            }`}
          >
            {actionStatus.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : actionStatus.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <ShieldCheck className="w-4 h-4 shrink-0" />
            )}
            <span>{actionStatus.message}</span>
          </div>
        )}

        {/* Body content per step */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#141923] border border-[#1e2637]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Layers className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Step 1: Secure Paper to the PEI Bed</h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Place your paper (Letter, A4, A5, or watercolor sheet) centered on the PEI spring steel build plate. Use low-tack blue painter&apos;s tape along the outer borders to keep the paper firmly flat and taut with zero bubbling.
                  </p>
                </div>
              </div>

              {/* Graphic representation */}
              <div className="h-56 bg-[#07090e] rounded-lg border border-[#1e2637] p-4 flex flex-col items-center justify-center relative">
                <div className="w-72 h-36 bg-[#18202d] border-2 border-dashed border-slate-600 rounded-md relative flex items-center justify-center shadow-inner">
                  <span className="text-[11px] font-mono text-slate-400">
                    Bambu PEI Bed ({spec.width}×{spec.depth}mm)
                  </span>
                  <div className="w-52 h-24 bg-slate-100 text-slate-900 rounded p-2 flex flex-col items-center justify-center shadow-lg relative">
                    <div className="absolute -top-1 left-4 w-10 h-3 bg-blue-500/80 rounded-xs shadow-xs transform -rotate-2" />
                    <div className="absolute -top-1 right-4 w-10 h-3 bg-blue-500/80 rounded-xs shadow-xs transform rotate-2" />
                    <div className="absolute -bottom-1 left-4 w-10 h-3 bg-blue-500/80 rounded-xs shadow-xs transform rotate-2" />
                    <div className="absolute -bottom-1 right-4 w-10 h-3 bg-blue-500/80 rounded-xs shadow-xs transform -rotate-2" />
                    <span className="text-xs font-bold text-slate-800">Drawing Paper</span>
                    <span className="text-[10px] text-slate-500">Taped at Corners</span>
                  </div>
                </div>
                <div className="mt-3 text-[11px] text-slate-400 flex items-center gap-2">
                  <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Ensure tape edges are flat so they do not catch on the pen tip during rapid travel.</span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#141923] border border-[#1e2637]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Step 2: Safe Machine Homing (NO PEN INSTALLED)</h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Bambu A1 printers use the nozzle load-cell sensor to probe the bed. <strong>Do NOT mount the pen yet.</strong> Run Safe Homing: the nozzle will touch the bed once, establish hardware zero, and automatically raise to Z=30mm clearance.
                  </p>
                </div>
              </div>

              <div className="p-6 bg-[#07090e] border border-[#1e2637] rounded-lg text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#141923] text-xs font-mono text-emerald-400 border border-[#222c3e]">
                  <span>HOTEND POSITION: ({telemetry.hotendPos.x.toFixed(1)}, {telemetry.hotendPos.y.toFixed(1)}, {telemetry.hotendPos.z.toFixed(1)} mm)</span>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    onClick={handleSafeHome}
                    disabled={isProcessing}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-lg shadow-emerald-950/40 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <Crosshair className="w-4 h-4" />
                    <span>1. Safe Home All Axes (G28)</span>
                  </button>

                  <button
                    onClick={handleMoveToHoverStation}
                    disabled={isProcessing}
                    className="px-5 py-2.5 bg-[#1a2333] hover:bg-[#232e42] disabled:opacity-50 text-cyan-300 text-xs font-bold rounded-lg border border-cyan-500/30 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <Move className="w-4 h-4 text-cyan-400" />
                    <span>2. Move to Floating Hover Station</span>
                  </button>
                </div>

                <div className="text-[11px] text-slate-400 max-w-md mx-auto leading-relaxed pt-2">
                  Once homed, move to the floating hover station. The nozzle will park safely ~25mm in the air and bed leveling compensation will be disabled so the height never drifts.
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#141923] border border-[#1e2637]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Crosshair className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Step 3: Floating Nozzle Seating &amp; Paper Zero (G92 Z0)</h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    The hotend nozzle floats safely in the air at <strong>Z={hoverHeightVal}mm</strong> (well clear of the bed). Loosen the clamp thumbscrew, let the pen slide down under gravity until the tip gently touches the paper, and tighten the clamp with zero downforce. Then click <strong>Lock Paper Zero</strong>!
                  </p>
                </div>
              </div>

              <div className="p-6 bg-[#07090e] border border-[#1e2637] rounded-lg space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Action 1 */}
                  <div className="bg-[#121722] border border-[#1f2838] p-4 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-cyan-400 font-mono font-bold">ACTION 1</span>
                      <span className="text-[10px] text-slate-400 font-mono">Nozzle floats {hoverHeightVal}mm high</span>
                    </div>
                    <h4 className="text-xs font-bold text-white">Park at Safe Floating Height</h4>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      Freezes Z plane (disables ABL mesh tilt) and floats nozzle at Z={hoverHeightVal}mm.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleMoveToHoverStation}
                        disabled={isProcessing}
                        className="flex-1 py-2 bg-[#1b2333] hover:bg-[#253147] text-slate-200 text-xs font-semibold rounded-lg border border-[#27344c] transition-colors cursor-pointer"
                      >
                        Hover Toolhead (Z={hoverHeightVal}mm)
                      </button>
                      <input
                        type="number"
                        min="15"
                        max="40"
                        step="1"
                        value={hoverHeightVal}
                        onChange={(e) => setHoverHeightVal(Math.max(15, Math.min(40, parseFloat(e.target.value) || 25)))}
                        className="w-16 bg-[#0d1017] border border-[#263145] text-white px-2 py-1.5 rounded text-xs font-mono text-center"
                        title="Floating Hover Height (mm)"
                      />
                    </div>
                  </div>

                  {/* Action 2 */}
                  <div className="bg-[#121722] border border-[#1f2838] p-4 rounded-lg space-y-2">
                    <span className="text-[10px] text-emerald-400 font-mono font-bold">ACTION 2</span>
                    <h4 className="text-xs font-bold text-white">Lock Paper Zero (G92 Z0)</h4>
                    <p className="text-[11px] text-slate-400 leading-snug">
                      Locks paper surface as Z=0 with M400 sync and lifts pen to travel height.
                    </p>
                    <button
                      onClick={handleLockPaperZero}
                      disabled={isProcessing}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-md transition-colors cursor-pointer mt-1"
                    >
                      Lock Paper Zero &amp; Lift Pen
                    </button>
                  </div>
                </div>

                {/* Travel Lift Slider */}
                <div className="pt-3 border-t border-[#1e2637] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">Pen Travel Lift Clearance:</span>
                    <span className="font-mono font-bold text-emerald-400">{travelLiftVal.toFixed(1)} mm</span>
                  </div>
                  <input
                    type="range"
                    min="2.0"
                    max="6.0"
                    step="0.5"
                    value={travelLiftVal}
                    onChange={(e) => setTravelLiftVal(parseFloat(e.target.value))}
                    className="w-full accent-emerald-500 h-1.5 bg-[#1b2333] rounded-lg cursor-pointer"
                  />
                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                    <span>2.0mm (Fast / Flat paper)</span>
                    <span>3.5mm (Recommended)</span>
                    <span>6.0mm (Thick cardstock)</span>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={handleTestLiftDrop}
                      disabled={isProcessing}
                      className="px-3 py-1.5 bg-[#161c28] hover:bg-[#202738] text-slate-300 text-[11px] rounded border border-[#273347] transition-colors cursor-pointer"
                    >
                      Test Lift & Drop
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#141923] border border-[#1e2637]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Move className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">Step 4: Paper Boundaries</h3>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    Pick a standard paper preset or jog the toolhead to record your custom corners. The software automatically maps the printable vector canvas inside this bounding box.
                  </p>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="p-4 bg-[#07090e] border border-[#1e2637] rounded-lg space-y-3">
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Quick Standard Presets:
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <button
                    onClick={() => applyPresetBounds('A4')}
                    className="p-2.5 bg-[#141923] hover:bg-[#1e2638] border border-[#242e42] rounded-lg text-left transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-bold text-white block">A4 Sheet</span>
                    <span className="text-[10px] text-slate-400 font-mono">Fit to bed</span>
                  </button>
                  <button
                    onClick={() => applyPresetBounds('A5')}
                    className="p-2.5 bg-[#141923] hover:bg-[#1e2638] border border-[#242e42] rounded-lg text-left transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-bold text-white block">A5 Sheet</span>
                    <span className="text-[10px] text-slate-400 font-mono">148×160mm</span>
                  </button>
                  <button
                    onClick={() => applyPresetBounds('A6')}
                    className="p-2.5 bg-[#141923] hover:bg-[#1e2638] border border-[#242e42] rounded-lg text-left transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-bold text-white block">A6 Postcard</span>
                    <span className="text-[10px] text-slate-400 font-mono">105×148mm</span>
                  </button>
                  <button
                    onClick={() => applyPresetBounds('SQUARE')}
                    className="p-2.5 bg-[#141923] hover:bg-[#1e2638] border border-[#242e42] rounded-lg text-left transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-bold text-white block">Square</span>
                    <span className="text-[10px] text-slate-400 font-mono">140×140mm</span>
                  </button>
                  <button
                    onClick={() => applyPresetBounds('FULL')}
                    className="p-2.5 bg-[#141923] hover:bg-[#1e2638] border border-[#242e42] rounded-lg text-left transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-bold text-white block">Full Bed</span>
                    <span className="text-[10px] text-slate-400 font-mono">{spec.width - 20}×{spec.depth - 20}mm</span>
                  </button>
                </div>
              </div>

              {/* Manual Jog & Record */}
              <div className="p-4 bg-[#07090e] border border-[#1e2637] rounded-lg space-y-3">
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Or Manually Jog to Corners:
                </span>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <button
                    onClick={() => recordCorner('tl')}
                    className="p-2 bg-[#141923] hover:bg-[#1e2638] border border-[#242e42] rounded text-left transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-slate-200 block">Top-Left</span>
                    <span className="text-[10px] text-emerald-400 font-mono">
                      {tl ? `(${tl.x}, ${tl.y}) mm` : 'Not recorded'}
                    </span>
                  </button>
                  <button
                    onClick={() => recordCorner('br')}
                    className="p-2 bg-[#141923] hover:bg-[#1e2638] border border-[#242e42] rounded text-left transition-colors cursor-pointer"
                  >
                    <span className="font-semibold text-slate-200 block">Bottom-Right</span>
                    <span className="text-[10px] text-emerald-400 font-mono">
                      {br ? `(${br.x}, ${br.y}) mm` : 'Not recorded'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="px-6 py-4 border-t border-[#1f2838] bg-[#0b0e14] flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step < 4 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <span>Continue</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleFinishWizard}
                className="px-6 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg flex items-center gap-1.5 shadow-lg shadow-emerald-950/40 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Finish & Save Calibration</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
