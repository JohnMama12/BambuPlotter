import React, { useState, useMemo } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  FileCode,
  Clock,
  Layers,
  Activity,
  AlertTriangle,
  Info
} from 'lucide-react';
import {
  PrinterModel,
  PenOffset,
  ZCalibration,
  PaperBounds,
  QualityPreset,
  SlicedPlotJob,
  PRINTER_SPECS,
} from '../types/plotter';
import { generateBambuPlotterGcode } from '../utils/gcodeGenerator';

interface GcodeExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  printerModel: PrinterModel;
  job: SlicedPlotJob | null;
  penOffset: PenOffset;
  zCalibration: ZCalibration;
  quality: QualityPreset;
  paperBounds: PaperBounds;
  syncAllSpeeds: boolean;
}

export const GcodeExportModal: React.FC<GcodeExportModalProps> = ({
  isOpen,
  onClose,
  printerModel,
  job,
  penOffset,
  zCalibration,
  quality,
  paperBounds,
  syncAllSpeeds,
}) => {
  const [copied, setCopied] = useState<boolean>(false);

  const spec = PRINTER_SPECS[printerModel];

  // Generate G-code
  const { gcode, totalCommands, warnings } = useMemo(() => {
    if (!job) {
      return { gcode: '', totalCommands: 0, warnings: [] };
    }
    return generateBambuPlotterGcode({
      model: printerModel,
      job,
      penOffset,
      zCalibration,
      quality,
      paperBounds,
      syncAllSpeeds,
    });
  }, [printerModel, job, penOffset, zCalibration, quality, paperBounds, syncAllSpeeds]);

  const fileSizeKb = useMemo(() => {
    return (new Blob([gcode]).size / 1024).toFixed(1);
  }, [gcode]);

  if (!isOpen || !job) return null;

  const handleDownload = () => {
    const filename = `bambu_${printerModel.toLowerCase()}_plot_${Date.now()}.gcode`;
    const blob = new Blob([gcode], { type: 'text/x-gcode;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(gcode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = gcode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Preview first 120 lines
  const previewLines = gcode.split('\n').slice(0, 120);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-[#0f131a] border border-[#222b3d] rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1f2838] flex items-center justify-between shrink-0 bg-[#0b0e14]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">
                Bambu G-Code Export Engine
              </h2>
              <p className="text-[11px] text-slate-400">
                Standards-compliant 2D toolpath file for {spec.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {/* Metrics strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#141923] border border-[#1e2637] rounded-lg p-3">
              <span className="text-[10px] text-slate-400 font-medium">TOTAL COMMANDS</span>
              <p className="text-lg font-mono font-bold text-slate-100 tabular-nums">
                {totalCommands.toLocaleString()}
              </p>
            </div>
            <div className="bg-[#141923] border border-[#1e2637] rounded-lg p-3">
              <span className="text-[10px] text-slate-400 font-medium">ESTIMATED PLOT TIME</span>
              <p className="text-lg font-mono font-bold text-cyan-400 tabular-nums">
                ~{Math.ceil(job.estimatedSeconds / 60)} min
              </p>
            </div>
            <div className="bg-[#141923] border border-[#1e2637] rounded-lg p-3">
              <span className="text-[10px] text-slate-400 font-medium">PEN LAYERS</span>
              <p className="text-lg font-mono font-bold text-slate-100 tabular-nums">
                {job.layersByPen.length} {job.layersByPen.length === 1 ? 'color' : 'colors'}
              </p>
            </div>
            <div className="bg-[#141923] border border-[#1e2637] rounded-lg p-3">
              <span className="text-[10px] text-slate-400 font-medium">ESTIMATED FILE SIZE</span>
              <p className="text-lg font-mono font-bold text-emerald-400 tabular-nums">
                {fileSizeKb} KB
              </p>
            </div>
          </div>

          {/* Warnings Banner if any */}
          {warnings.length > 0 && (
            <div className="bg-amber-950/20 border border-amber-800/40 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-[11px]">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Export Safety Notice</span>
              </div>
              {warnings.map((w, idx) => (
                <p key={idx} className="text-[11px] text-amber-300/80 pl-5">
                  • {w}
                </p>
              ))}
            </div>
          )}

          {/* Instruction Card */}
          <div className="bg-[#141923] border border-[#1e2637] rounded-lg p-3 flex items-start gap-2.5 text-slate-300">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-semibold text-slate-100">Ready for Standalone Printing: </span>
              Save this file directly to your printer&apos;s MicroSD card or upload through Bambu Studio / OrcaSlicer. The file includes cold-extrusion commands (<code className="font-mono text-cyan-300">M104 S0</code>, <code className="font-mono text-cyan-300">M140 S0</code>), acceleration limits, and pauses (<code className="font-mono text-cyan-300">M0</code>) for multi-pen color swaps.
            </div>
          </div>

          {/* G-Code Code Viewer */}
          <div className="border border-[#1e2637] rounded-lg overflow-hidden bg-[#07090e]">
            <div className="px-4 py-2 border-b border-[#1e2637] bg-[#0c1017] flex items-center justify-between">
              <span className="font-mono text-[11px] text-slate-400">
                G-Code Syntax Preview ({Math.min(120, gcode.split('\n').length)} of {gcode.split('\n').length} lines)
              </span>
              <button
                onClick={handleCopy}
                className="text-slate-300 hover:text-white flex items-center gap-1 text-[11px] cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-medium">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                    <span>Copy All</span>
                  </>
                )}
              </button>
            </div>
            <pre className="p-4 font-mono text-[11px] text-slate-300 max-h-64 overflow-y-auto leading-relaxed select-all">
              {previewLines.map((line, idx) => {
                const isComment = line.trim().startsWith(';');
                const isGcode = /^(G0|G1|G21|G90|M104|M140|M106|M204|M400|M0)/i.test(line.trim());
                return (
                  <div key={idx} className="flex">
                    <span className="w-10 text-slate-600 select-none tabular-nums text-right pr-3 shrink-0">
                      {idx + 1}
                    </span>
                    <span
                      className={
                        isComment
                          ? 'text-slate-500 italic'
                          : isGcode
                          ? 'text-emerald-400 font-medium'
                          : 'text-slate-300'
                      }
                    >
                      {line}
                    </span>
                  </div>
                );
              })}
            </pre>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#1f2838] bg-[#0b0e14] flex items-center justify-between shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            Close
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCopy}
              className="px-4 py-2 text-xs font-medium text-slate-200 bg-[#161d2b] hover:bg-[#1e273a] border border-[#27334a] rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Copied to Clipboard</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy G-Code</span>
                </>
              )}
            </button>

            <button
              onClick={handleDownload}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg shadow-lg shadow-emerald-950/40 transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download .gcode ({fileSizeKb} KB)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
