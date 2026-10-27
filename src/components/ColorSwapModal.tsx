import React from 'react';
import { PenDefinition } from '../types/plotter';
import { AlertTriangle, CheckCircle2, ArrowDown } from 'lucide-react';

interface ColorSwapModalProps {
  isOpen: boolean;
  nextPen: PenDefinition | null;
  penIndex: number;
  totalPens: number;
  onResume: () => void;
  onAbort: () => void;
}

export const ColorSwapModal: React.FC<ColorSwapModalProps> = ({
  isOpen,
  nextPen,
  penIndex,
  totalPens,
  onResume,
  onAbort,
}) => {
  if (!isOpen || !nextPen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="bg-[#121620] border-2 border-amber-500/50 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className="px-6 py-4 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold">
                Multi-Color Sequence · Pen {penIndex + 1} of {totalPens}
              </div>
              <h3 className="text-base font-bold text-white">Manual Pen Swap Required</h3>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Target Pen Details */}
          <div className="p-4 rounded-lg bg-[#161c28] border border-[#232d3f] flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-full border-2 border-white/30 shadow-md shrink-0 flex items-center justify-center"
              style={{ backgroundColor: nextPen.hex }}
            />
            <div>
              <div className="text-sm font-bold text-white">{nextPen.name}</div>
              <div className="text-xs font-mono text-slate-400 mt-0.5">
                Tip Diameter: <span className="text-emerald-400 font-bold">{nextPen.diameter}mm</span> · Type: {nextPen.penType}
              </div>
            </div>
          </div>

          {/* Enforced Calibration Steps */}
          <div className="space-y-2.5 text-xs text-slate-300">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-[#0d1017] border border-[#1e2536]">
              <div className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-mono font-bold shrink-0 mt-0.5">
                1
              </div>
              <div>
                <span className="font-semibold text-white">Z Draw Plane Preserved:</span>
                <p className="text-slate-400 mt-0.5 leading-relaxed">
                  The toolhead is parked at the travel height above the software draw plane.
                  No homing occurs during a pen swap, so the nozzle never touches the bed and
                  the pen cannot be dislodged. Seat this pen until its tip just touches the paper
                  when lowered, then tighten the clamp.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-[#0d1017] border border-[#1e2536]">
              <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-mono font-bold shrink-0 mt-0.5">
                2
              </div>
              <div>
                <span className="font-semibold text-white">Insert & Seat New Marker:</span>
                <p className="text-slate-400 mt-0.5 leading-relaxed">
                  The toolhead is parked on the software draw plane (not re-homed). Loosen the clamp,
                  remove the previous pen, and slide <strong className="text-white">{nextPen.name}</strong> in
                  until its tip just touches the paper. Tighten the thumbscrew, then resume.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#1e2536] bg-[#0c0f16] flex items-center justify-between">
          <button
            onClick={onAbort}
            className="px-4 py-2 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
          >
            Abort Plot
          </button>

          <button
            onClick={onResume}
            className="px-6 py-2.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-950/40 flex items-center gap-2 transition-colors"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Confirm Pen Seated & Resume Plot</span>
          </button>
        </div>
      </div>
    </div>
  );
};
