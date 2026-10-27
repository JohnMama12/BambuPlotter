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
  AlertCircle
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
  getBedReference,
  getDrawZ,
  getTravelZ,
  normalizeZCalibration,
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
  const [retractionLiftVal, setRetractionLiftVal] = useState<number>(
    clampPenRelease(zCalibration.penReleaseMm)
  );
  const [jogStep, setJogStep] = useState<number>(10);

  const handleRefreshPosition = () => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected via MQTT.');
      return;
    }
    // Send a dummy move to current position to force a position report
    const pos = telemetry.hotendPos;
    bambuMachine.sendRawGcode(`G0 X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)} Z${pos.z.toFixed(3)}`);
  };

  // 4 corners mapping state
  const [tl, setTl] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.topLeft : null);
  const [tr, setTr] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.topRight : null);
  const [bl, setBl] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.bottomLeft : null);
  const [br, setBr] = useState<Point2D | null>(paperBounds.isCalibrated ? paperBounds.bottomRight : null);

  if (!isOpen) return null;

  const spec = PRINTER_SPECS[printerModel];
  const bedRef = getBedReference(zCalibration);
  const previewDrawZ = getDrawZ(zCalibration);
  const previewTravelZ = getTravelZ({ ...zCalibration, penReleaseMm: retractionLiftVal });
  const zReady = zCalibration.datumSource === 'bed_stop' && zCalibration.isCalibrated;

  const handleHomeAll = () => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected! Please open "Bambu Printer Link" and click "Verify & Connect" first.');
      return;
    }
    const ok = window.confirm(
      'Homing (G28) makes the nozzle touch the bed.\n\nRemove the pen first or it may be crushed / dislodged.\n\nContinue?'
    );
    if (!ok) return;
    bambuMachine.homeAll();
  };

  const handleCaptureBedReference = () => {
    const result = bambuMachine.captureBedReference();
    if (!result.success) {
      alert(result.error || 'Could not capture the bed reference.');
    }
  };

  const handleFineAdjustZ = async (deltaMm: number) => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected via MQTT.');
      return;
    }
    const result = await bambuMachine.fineAdjustZ(deltaMm);
    if (!result.success) {
      alert(result.error || 'Fine Z adjust failed.');
    }
  };

  const handleGoToDrawHeight = async () => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected via MQTT.');
      return;
    }
    if (!zReady) {
      alert('No bed reference captured yet. Complete Step 2 first.');
      return;
    }
    // After homing, nozzle is at bed (Z=0). Just move Z up by 3mm (draw height).
    // Use relative move to avoid any XY motion or coordinate issues.
    await bambuMachine.sendRawGcode('G91 G0 Z3 F600 G90');
    alert('Moved Z up 3mm to draw height. Adjust pen until tip just touches paper.');
  };

  const handleJog = (axis: 'x' | 'y', dir: number) => {
    const telemetry = bambuMachine.getTelemetry();
    if (!telemetry.isConnected || telemetry.connectionMode !== 'mqtt') {
      alert('Printer not connected! Please open "Bambu Printer Link" and click "Verify & Connect" first.');
      return;
    }
    bambuMachine.jog(axis, dir * jogStep);
  };

  const recordCorner = (corner: 'tl' | 'tr' | 'bl' | 'br') => {
    const pt = { x: Math.round(currentPenPos.x * 10) / 10, y: Math.round(currentPenPos.y * 10) / 10 };
    if (corner === 'tl') setTl(pt);
    if (corner === 'tr') setTr(pt);
    if (corner === 'bl') setBl(pt);
    if (corner === 'br') setBr(pt);
  };

  const handleSaveStep3 = () => {
    if (!zReady) {
      alert(
        'No bed reference captured yet. Go back to Step 2, home the printer, jog Z down until the toolhead stops at the bed, then press "Capture Bed Reference".'
      );
      setStep(2);
      return;
    }
    const updated = normalizeZCalibration(
      {
        ...zCalibration,
        penReleaseMm: clampPenRelease(retractionLiftVal),
      },
      printerModel
    );
    onSaveZCalibration(updated);
    setStep(4);
  };

  const handleCompleteWizard = () => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#12161f] border border-[#232b3b] rounded-xl max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#232b3b] flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold">
                Bambu {printerModel === 'A1_MINI' ? 'A1 Mini' : 'A1'}
              </span>
              <span className="text-slate-600 text-xs">·</span>
              <span className="text-xs text-slate-400">One-Time Calibration Wizard</span>
            </div>
            <h2 className="text-lg font-bold text-white mt-0.5">Pen Offset & Paper Boundary Setup</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-3 bg-[#0d1017] border-b border-[#1e2533] flex items-center justify-between text-xs">
          {[
            { num: 1, label: '1. Tape Paper' },
            { num: 2, label: '2. Bed Reference' },
            { num: 3, label: '3. Pen Release' },
            { num: 4, label: '4. Map Boundaries' },
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

        {/* Body content per step */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#161c28] border border-[#242e42]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Layers className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Step 1: Secure Paper to the PEI Plate</h3>
                  <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                    Place a plain sheet of printer paper (Letter, A4, or custom cardstock) onto your PEI build plate. Use low-tack blue painter&apos;s tape along the outer borders to keep the paper firmly flat and taut.
                  </p>
                </div>
              </div>

              {/* Visual Graphic Representation */}
              <div className="h-56 bg-[#0a0d13] rounded-lg border border-[#1e2636] p-4 flex flex-col items-center justify-center relative">
                <div className="w-72 h-40 bg-[#1e2533] border-2 border-dashed border-slate-600 rounded-md relative flex items-center justify-center shadow-inner">
                  <span className="text-xs font-mono text-slate-400">Bambu PEI Bed ({spec.width}×{spec.depth}mm)</span>
                  {/* Paper sheet */}
                  <div className="w-52 h-28 bg-slate-100/90 text-slate-800 rounded p-2 flex flex-col items-center justify-center shadow-lg relative">
                    {/* Tape accents on 4 edges */}
                    <div className="absolute -top-1 left-4 w-12 h-3 bg-blue-500/80 rounded-xs shadow-sm transform -rotate-2" />
                    <div className="absolute -top-1 right-4 w-12 h-3 bg-blue-500/80 rounded-xs shadow-sm transform rotate-2" />
                    <div className="absolute -bottom-1 left-4 w-12 h-3 bg-blue-500/80 rounded-xs shadow-sm transform rotate-2" />
                    <div className="absolute -bottom-1 right-4 w-12 h-3 bg-blue-500/80 rounded-xs shadow-sm transform -rotate-2" />
                    <span className="text-xs font-semibold text-slate-700">Plain Printer Paper</span>
                    <span className="text-[10px] text-slate-500 mt-0.5">Painter&apos;s Tape on Corners</span>
                  </div>
                </div>
                <div className="mt-3 text-xs text-slate-400 flex items-center gap-2">
                  <HelpCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ensure no tape buckles or wrinkles fold upward into the toolhead path.</span>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#161c28] border border-[#242e42]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Crosshair className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Step 2: Find the Bed, then Capture It</h3>
                  <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                    Remove the pen. Home the printer, then jog <strong>Z down</strong> until the toolhead
                    physically stops at the bed. The printer itself will not let you go lower. Press{' '}
                    <strong>Capture Bed Reference</strong>: nothing moves. That height is stored, and the
                    drawing plane is permanently locked to <strong>bed + {Z_SAFETY.BED_CLEARANCE_MM.toFixed(1)} mm</strong>.
                  </p>
                </div>
              </div>

              <div className="p-6 bg-[#0a0d13] border border-[#1e2636] rounded-lg text-center space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#161c27] text-xs font-mono text-emerald-400 border border-[#273247]">
                  <span>CURRENT HOTEND: ({bambuMachine.getTelemetry().hotendPos.x.toFixed(1)}, {bambuMachine.getTelemetry().hotendPos.y.toFixed(1)}, {bambuMachine.getTelemetry().hotendPos.z.toFixed(1)} mm)</span>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={handleHomeAll}
                    className="px-4 py-2 bg-[#1b2333] hover:bg-[#253047] text-slate-300 text-xs rounded-lg border border-[#2a3447]"
                  >
                    Home All (G28)
                  </button>
                  <button
                    onClick={handleRefreshPosition}
                    className="px-4 py-2 bg-[#1b2333] hover:bg-[#253047] text-cyan-300 text-xs rounded-lg border border-cyan-500/30"
                    title="Request fresh position from printer"
                  >
                    Refresh Position
                  </button>
                </div>

                {/* Fine Z Adjust */}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-[#1e2636]">
                  <span className="text-[10px] text-slate-500">Fine Adjust Z:</span>
                  <button
                    onClick={() => handleFineAdjustZ(-0.05)}
                    className="px-3 py-1.5 bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-bold rounded-lg border border-rose-500/30"
                    title="Lower Z by 0.05mm (toward bed)"
                  >
                    −0.05mm
                  </button>
                  <button
                    onClick={() => handleFineAdjustZ(0.05)}
                    className="px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg border border-emerald-500/30"
                    title="Raise Z by 0.05mm (away from bed)"
                  >
                    +0.05mm
                  </button>
                  <button
                    onClick={() => handleFineAdjustZ(-0.1)}
                    className="px-3 py-1.5 bg-rose-600/60 hover:bg-rose-500 text-white text-xs font-bold rounded-lg border border-rose-500/20"
                    title="Lower Z by 0.1mm"
                  >
                    −0.1mm
                  </button>
                  <button
                    onClick={() => handleFineAdjustZ(0.1)}
                    className="px-3 py-1.5 bg-emerald-600/60 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg border border-emerald-500/20"
                    title="Raise Z by 0.1mm"
                  >
                    +0.1mm
                  </button>
                </div>

                <div className="pt-2 border-t border-[#1e2636]">
                  <button
                    onClick={handleCaptureBedReference}
                    className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm rounded-lg shadow-lg shadow-emerald-950/40 transition-all flex items-center gap-2 mx-auto"
                  >
                    <Crosshair className="w-4 h-4" />
                    <span>Capture Bed Reference</span>
                  </button>
                  <p className="text-xs text-slate-400 mt-2">
                    No motion, no bed probing. Draw plane:{' '}
                    <span className="font-mono text-emerald-400">
                      {zReady ? `${previewDrawZ.toFixed(2)} mm` : 'waiting for capture'}
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#161c28] border border-[#242e42]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <ArrowDown className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Step 3: Seat the Pen & Set Release Height</h3>
                  <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                    Move the toolhead to the fixed drawing plane ({previewDrawZ.toFixed(2)} mm) and
                    physically adjust the pen in its holder until the tip <strong>just touches the paper</strong>.
                    There is no pen-height calibration anymore. The only adjustable value is the{' '}
                    <strong>pen release height</strong>: how far the pen lifts between strokes.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-[#141a26] border border-[#242e42] rounded-lg space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Locked Heights
                  </div>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Captured bed reference</span>
                      <span className="text-white">{bedRef.toFixed(2)} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Drawing plane (fixed)</span>
                      <span className="text-emerald-400">{previewDrawZ.toFixed(2)} mm</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Bed clearance</span>
                      <span className="text-white">{Z_SAFETY.BED_CLEARANCE_MM.toFixed(2)} mm</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    The drawing plane cannot be edited. Re-run Step 2 if the bed reference is wrong.
                  </p>
                  <button
                    onClick={handleGoToDrawHeight}
                    className="w-full py-2 bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
                    title="Move toolhead to draw height (bed + 1mm) so you can seat the pen"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                    <span>Go to Draw Height (bed + 1mm)</span>
                  </button>
                </div>

                <div className="p-4 bg-[#141a26] border border-[#242e42] rounded-lg space-y-3">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Pen Release Height ({Z_SAFETY.MIN_PEN_RELEASE_MM}–{Z_SAFETY.MAX_PEN_RELEASE_MM} mm)
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      step="0.1"
                      min={Z_SAFETY.MIN_PEN_RELEASE_MM}
                      max={Z_SAFETY.MAX_PEN_RELEASE_MM}
                      value={retractionLiftVal}
                      onChange={(e) => setRetractionLiftVal(clampPenRelease(e.target.value))}
                      className="bg-[#0b0e14] border border-[#28344a] text-white px-3 py-2 rounded-lg font-mono text-sm w-28 focus:outline-hidden focus:border-emerald-500"
                    />
                    <span className="text-xs text-slate-400">mm above draw plane</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Rapid moves use {previewTravelZ.toFixed(2)}mm; drawing uses{' '}
                    {previewDrawZ.toFixed(2)}mm.
                  </p>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2.5 text-xs text-amber-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Clicking Next saves the bed reference and pen release height. A Z lower than the
                  drawing plane is rejected by the UI, the machine controller and the server.
                </span>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-[#161c28] border border-[#242e42]">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0">
                  <Crosshair className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Step 4: Map 4 Coordinates of Paper Sheet</h3>
                  <p className="text-sm text-slate-300 mt-1 leading-relaxed">
                    At the captured drawing height, use the jog controls below to move the toolhead and bed slinger to each corner of your taped paper sheet. Click each button to record TOP LEFT, TOP RIGHT, BOTTOM LEFT, and BOTTOM RIGHT.
                  </p>
                </div>
              </div>

              {/* Live Coordinates HUD */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 bg-[#0e121a] border border-[#20293a] rounded-lg">
                  <div className="text-[10px] uppercase font-mono text-slate-400">Pen Live (X, Y)</div>
                  <div className="text-sm font-mono font-bold text-cyan-400 mt-0.5">
                    {currentPenPos.x.toFixed(1)}, {currentPenPos.y.toFixed(1)} mm
                  </div>
                </div>
                <div className="p-2.5 bg-[#0e121a] border border-[#20293a] rounded-lg">
                  <div className="text-[10px] uppercase font-mono text-slate-400">Nozzle Live (X, Y)</div>
                  <div className="text-sm font-mono font-bold text-slate-300 mt-0.5">
                    {(currentPenPos.x - penOffset.x).toFixed(1)}, {(currentPenPos.y - penOffset.y).toFixed(1)} mm
                  </div>
                </div>
                <div className="p-2.5 bg-[#0e121a] border border-[#20293a] rounded-lg">
                  <div className="text-[10px] uppercase font-mono text-slate-400">Hotend-to-Pen Offset</div>
                  <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5">
                    X:{penOffset.x} Y:{penOffset.y}mm
                  </div>
                </div>
                <div className="p-2.5 bg-[#0e121a] border border-[#20293a] rounded-lg">
                  <div className="text-[10px] uppercase font-mono text-slate-400">Jog Step Size</div>
                  <div className="flex gap-1 mt-0.5">
                    {[1, 5, 10, 25].map((s) => (
                      <button
                        key={s}
                        onClick={() => setJogStep(s)}
                        className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${
                          jogStep === s ? 'bg-emerald-600 text-white' : 'bg-[#1b2333] text-slate-400 hover:text-white'
                        }`}
                      >
                        {s}mm
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Jog Direction Pad (Bed Slinger Kinematics) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#0a0d13] p-4 rounded-lg border border-[#1e2636]">
                <div className="flex flex-col items-center justify-center space-y-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                    Bed Slinger (Y) & Toolhead (X) Jog
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 w-44">
                    <div />
                    <button
                      onClick={() => handleJog('y', 1)}
                      className="p-2 bg-[#1b2333] hover:bg-[#253047] text-white rounded font-mono text-xs font-bold flex flex-col items-center justify-center border border-[#28364c]"
                      title="Bed slides backward (+Y coordinate)"
                    >
                      <span>+Y</span>
                      <span className="text-[8px] text-slate-400">Bed Back</span>
                    </button>
                    <div />
                    <button
                      onClick={() => handleJog('x', -1)}
                      className="p-2 bg-[#1b2333] hover:bg-[#253047] text-white rounded font-mono text-xs font-bold flex flex-col items-center justify-center border border-[#28364c]"
                      title="Toolhead travels Left (-X coordinate)"
                    >
                      <span>-X</span>
                      <span className="text-[8px] text-slate-400">Head Left</span>
                    </button>
                    <div />
                    <button
                      onClick={() => handleJog('x', 1)}
                      className="p-2 bg-[#1b2333] hover:bg-[#253047] text-white rounded font-mono text-xs font-bold flex flex-col items-center justify-center border border-[#28364c]"
                      title="Toolhead travels Right (+X coordinate)"
                    >
                      <span>+X</span>
                      <span className="text-[8px] text-slate-400">Head Right</span>
                    </button>
                    <div />
                    <button
                      onClick={() => handleJog('y', -1)}
                      className="p-2 bg-[#1b2333] hover:bg-[#253047] text-white rounded font-mono text-xs font-bold flex flex-col items-center justify-center border border-[#28364c]"
                      title="Bed slides forward toward user (-Y coordinate)"
                    >
                      <span>-Y</span>
                      <span className="text-[8px] text-slate-400">Bed Front</span>
                    </button>
                    <div />
                  </div>
                </div>

                {/* 4 Corner Capture Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => recordCorner('tl')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      tl ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200' : 'bg-[#141b27] border-[#253147] text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>1. TOP LEFT</span>
                      {tl && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <div className="text-[11px] font-mono mt-1 text-slate-400">
                      {tl ? `(${tl.x}, ${tl.y}) mm` : 'Click to save pos'}
                    </div>
                  </button>

                  <button
                    onClick={() => recordCorner('tr')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      tr ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200' : 'bg-[#141b27] border-[#253147] text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>2. TOP RIGHT</span>
                      {tr && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <div className="text-[11px] font-mono mt-1 text-slate-400">
                      {tr ? `(${tr.x}, ${tr.y}) mm` : 'Click to save pos'}
                    </div>
                  </button>

                  <button
                    onClick={() => recordCorner('bl')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      bl ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200' : 'bg-[#141b27] border-[#253147] text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>3. BOTTOM LEFT</span>
                      {bl && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <div className="text-[11px] font-mono mt-1 text-slate-400">
                      {bl ? `(${bl.x}, ${bl.y}) mm` : 'Click to save pos'}
                    </div>
                  </button>

                  <button
                    onClick={() => recordCorner('br')}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      br ? 'bg-cyan-950/40 border-cyan-500 text-cyan-200' : 'bg-[#141b27] border-[#253147] text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>4. BOTTOM RIGHT</span>
                      {br && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </div>
                    <div className="text-[11px] font-mono mt-1 text-slate-400">
                      {br ? `(${br.x}, ${br.y}) mm` : 'Click to save pos'}
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="px-6 py-4 border-t border-[#232b3b] bg-[#0f131c] flex items-center justify-between">
          <div>
            {step > 1 && (
              <button
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-[#1b2230] hover:bg-[#242e40] flex items-center gap-1.5 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Previous Step</span>
              </button>
            )}
            {step === 1 && (
              <button
                onClick={onClearCalibration}
                className="text-xs text-rose-400 hover:text-rose-300 underline underline-offset-4"
              >
                Clear Existing Calibration Settings
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step < 3 && (
              <button
                onClick={() => setStep(step + 1)}
                className="px-5 py-2 rounded-lg text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-950/40 flex items-center gap-1.5 transition-colors"
              >
                <span>Continue to Step {step + 1}</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 3 && (
              <button
                onClick={handleSaveStep3}
                className="px-5 py-2 rounded-lg text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-950/40 flex items-center gap-1.5 transition-colors"
              >
                <span>Save Bed Reference & Map Paper</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {step === 4 && (
              <button
                onClick={handleCompleteWizard}
                className="px-6 py-2 rounded-lg text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 shadow-md shadow-emerald-950/40 flex items-center gap-2 transition-colors font-semibold"
              >
                <Sparkles className="w-4 h-4" />
                <span>Save Boundaries & Ready to Print</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
