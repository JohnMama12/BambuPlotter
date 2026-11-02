import React, { useState, useMemo } from 'react';
import {
  X,
  FileCode,
  Check,
  Maximize,
  Minimize,
  Sliders,
  Sparkles,
  Layers,
  ArrowRight
} from 'lucide-react';
import {
  CanvasElement,
  PenDefinition,
  PaperBounds,
  PrinterModel,
  PRINTER_SPECS,
  InfillPattern,
} from '../types/plotter';

interface SvgImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  svgContent: string;
  fileName: string;
  pens: PenDefinition[];
  paperBounds: PaperBounds;
  printerModel: PrinterModel;
  onConfirmImport: (element: CanvasElement) => void;
}

type PlacementMode = 'fit_paper' | 'fit_bed' | 'original';

export const SvgImportModal: React.FC<SvgImportModalProps> = ({
  isOpen,
  onClose,
  svgContent,
  fileName,
  pens,
  paperBounds,
  printerModel,
  onConfirmImport,
}) => {
  const spec = PRINTER_SPECS[printerModel];

  // Parse natural dimensions and aspect ratio from SVG string
  const svgMeta = useMemo(() => {
    let vbW = 100;
    let vbH = 100;

    const vbMatch = svgContent.match(/viewBox\s*=\s*["']([^"']+)["']/i);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
      if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
        vbW = parts[2];
        vbH = parts[3];
      }
    } else {
      const wMatch = svgContent.match(/width\s*=\s*["']([^"']+)["']/i);
      const hMatch = svgContent.match(/height\s*=\s*["']([^"']+)["']/i);
      const parseUnit = (val: string): number => {
        const num = parseFloat(val);
        if (isNaN(num)) return 100;
        if (val.includes('mm')) return num;
        if (val.includes('cm')) return num * 10;
        if (val.includes('in')) return num * 25.4;
        if (val.includes('pt')) return num * 0.352778;
        return num / 3.7795; // default px at 96 DPI to mm
      };
      if (wMatch && hMatch) {
        vbW = parseUnit(wMatch[1]);
        vbH = parseUnit(hMatch[1]);
      }
    }

    const aspectRatio = vbW / Math.max(1, vbH);
    return { vbW, vbH, aspectRatio };
  }, [svgContent]);

  const [placementMode, setPlacementMode] = useState<PlacementMode>(() =>
    paperBounds.isCalibrated ? 'fit_paper' : 'fit_bed'
  );
  const [selectedPenId, setSelectedPenId] = useState<string>(pens[0]?.id || 'pen-black');
  const [fillStyle, setFillStyle] = useState<InfillPattern>('outline');
  const [hatchAngle, setHatchAngle] = useState<number>(45);
  const [hatchSpacingMm, setHatchSpacingMm] = useState<number>(0.8);

  if (!isOpen || !svgContent) return null;

  // Calculate placement dimensions based on chosen mode
  let targetWidth = 60;
  let targetHeight = 60;
  let targetX = 20;
  let targetY = 20;

  const ar = svgMeta.aspectRatio;

  if (placementMode === 'fit_paper' && paperBounds.isCalibrated) {
    const margin = 10;
    const availW = Math.max(20, paperBounds.widthMm - margin * 2);
    const availH = Math.max(20, paperBounds.heightMm - margin * 2);

    if (availW / availH > ar) {
      targetHeight = Math.round(availH * 10) / 10;
      targetWidth = Math.round(targetHeight * ar * 10) / 10;
    } else {
      targetWidth = Math.round(availW * 10) / 10;
      targetHeight = Math.round((targetWidth / ar) * 10) / 10;
    }

    targetX = Math.round((paperBounds.bottomLeft.x + (paperBounds.widthMm - targetWidth) / 2) * 10) / 10;
    targetY = Math.round((paperBounds.bottomLeft.y + (paperBounds.heightMm - targetHeight) / 2) * 10) / 10;
  } else if (placementMode === 'fit_bed' || !paperBounds.isCalibrated) {
    const margin = 20;
    const availW = spec.width - margin * 2;
    const availH = spec.depth - margin * 2;

    if (availW / availH > ar) {
      targetHeight = Math.round(availH * 10) / 10;
      targetWidth = Math.round(targetHeight * ar * 10) / 10;
    } else {
      targetWidth = Math.round(availW * 10) / 10;
      targetHeight = Math.round((targetWidth / ar) * 10) / 10;
    }

    targetX = Math.round(((spec.width - targetWidth) / 2) * 10) / 10;
    targetY = Math.round(((spec.depth - targetHeight) / 2) * 10) / 10;
  } else {
    // Original dimensions (converted to mm)
    targetWidth = Math.min(spec.width - 20, Math.max(10, Math.round(svgMeta.vbW * 10) / 10));
    targetHeight = Math.min(spec.depth - 20, Math.max(10, Math.round(svgMeta.vbH * 10) / 10));
    targetX = Math.round(((spec.width - targetWidth) / 2) * 10) / 10;
    targetY = Math.round(((spec.depth - targetHeight) / 2) * 10) / 10;
  }

  const handleImport = () => {
    const cleanName = fileName.replace(/\.svg$/i, '') || 'Imported Vector';
    const newElement: CanvasElement = {
      id: `svg-${Date.now()}`,
      type: 'svg',
      name: cleanName,
      penId: selectedPenId,
      x: targetX,
      y: targetY,
      width: targetWidth,
      height: targetHeight,
      rotation: 0,
      scale: 1,
      fillStyle,
      hatchAngle,
      hatchSpacingMm,
      svgString: svgContent,
    };
    onConfirmImport(newElement);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#10141e] border border-[#232b3b] rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#232b3b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-950/60 border border-purple-500/40 flex items-center justify-center text-purple-400">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white leading-tight">Import Vector Graphic (SVG)</h3>
              <p className="text-[11px] text-slate-400 truncate max-w-xs">{fileName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Detected Dimensions Banner */}
          <div className="p-3 rounded-lg bg-[#0c0f16] border border-[#1e2536] flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-slate-500 block text-[10px] uppercase">Original Aspect Ratio</span>
              <span className="text-slate-200 font-bold">
                {ar.toFixed(2)} : 1 {ar > 1.1 ? '(Landscape)' : ar < 0.9 ? '(Portrait)' : '(Square)'}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-500 block text-[10px] uppercase">Placed Target Size</span>
              <span className="text-emerald-400 font-bold">
                {targetWidth.toFixed(1)} × {targetHeight.toFixed(1)} mm
              </span>
            </div>
          </div>

          {/* Sizing & Placement Mode Selection */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
              Placement &amp; Proportional Sizing
            </label>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setPlacementMode('fit_paper')}
                className={`w-full p-3 rounded-lg border text-left transition-all flex items-start gap-3 ${
                  placementMode === 'fit_paper'
                    ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="p-1.5 rounded-md bg-[#161c28] text-emerald-400 shrink-0 mt-0.5">
                  <Minimize className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Fit to Calibrated Paper Bounds</span>
                    {paperBounds.isCalibrated ? (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                        Calibrated ({paperBounds.widthMm}×{paperBounds.heightMm}mm)
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono">
                        Paper not yet mapped
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Scales proportionally inside paper borders and automatically centers on the sheet.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPlacementMode('fit_bed')}
                className={`w-full p-3 rounded-lg border text-left transition-all flex items-start gap-3 ${
                  placementMode === 'fit_bed'
                    ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="p-1.5 rounded-md bg-[#161c28] text-cyan-400 shrink-0 mt-0.5">
                  <Maximize className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">
                    Fit to Printable Bed ({spec.width}×{spec.depth} mm)
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Maximizes drawing size across the printable bed slinger envelope while preserving aspect ratio.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setPlacementMode('original')}
                className={`w-full p-3 rounded-lg border text-left transition-all flex items-start gap-3 ${
                  placementMode === 'original'
                    ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="p-1.5 rounded-md bg-[#161c28] text-purple-400 shrink-0 mt-0.5">
                  <Sliders className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white">Original Document Scale (1:1 mm)</div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                    Uses physical millimeter or point dimensions specified directly in the SVG file.
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Pen Swatch Selection */}
          <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2">
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
              Assigned Pen Color
            </span>
            <div className="grid grid-cols-5 gap-1.5">
              {pens.map((pen) => (
                <button
                  key={pen.id}
                  type="button"
                  onClick={() => setSelectedPenId(pen.id)}
                  className={`p-1.5 rounded-lg flex flex-col items-center justify-center gap-1 border transition-all ${
                    selectedPenId === pen.id
                      ? 'ring-2 ring-emerald-400 border-transparent bg-[#18202e]'
                      : 'border-[#222b3a] bg-[#121620] hover:border-slate-500'
                  }`}
                  title={`${pen.name} (${pen.diameter}mm)`}
                >
                  <div
                    className="w-4 h-4 rounded-full border border-black/40 shadow-xs"
                    style={{ backgroundColor: pen.hex }}
                  />
                  <span className="text-[9px] font-mono text-slate-400 truncate max-w-full">
                    {pen.name.split(' ')[0]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Initial Vector Fill Style */}
          <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2">
            <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider block">
              Initial Fill Style
            </span>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              {[
                { id: 'outline', label: 'Outline Only' },
                { id: 'parallel_hatch', label: 'Parallel Hatch' },
                { id: 'crosshatch', label: 'Crosshatch' },
              ].map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => setFillStyle(style.id as InfillPattern)}
                  className={`p-2 rounded-lg text-center border transition-all ${
                    fillStyle === style.id
                      ? 'bg-emerald-950/50 border-emerald-500 text-emerald-300 font-bold'
                      : 'bg-[#121620] border-[#222b3a] text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#232b3b] bg-[#0c0f16] flex items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] font-mono text-slate-400">
            Placed at ({targetX}, {targetY}) mm
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={handleImport}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-950/40 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Import to Canvas</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
