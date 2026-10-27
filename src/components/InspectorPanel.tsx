import React, { useState, useEffect } from 'react';
import {
  CanvasElement,
  PenDefinition,
  PrinterModel,
  PRINTER_SPECS,
  PenOffset,
  ZCalibration,
  QualityPreset,
  QUALITY_PRESETS,
  InfillPattern,
  PaperBounds,
} from '../types/plotter';
import {
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Sliders,
  Circle,
  Square,
  Slash,
  Layers,
  Sparkles,
  Gauge,
  Lock,
  Unlock,
  Search,
  Crosshair,
  AlertTriangle,
} from 'lucide-react';
import { bambuMachine } from '../services/bambuService';
import {
  Z_SAFETY,
  clampPenRelease,
  getBedReference,
  getDrawZ,
  getTravelZ,
  getZFloor,
  isZSafeToPlot,
} from '../utils/zSafety';

export const SYSTEM_FONTS_CATALOG = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
  'Segoe UI',
  'Roboto',
  'Palatino',
  'Garamond',
  'Lucida Console',
  'Consolas',
  'Plus Jakarta Sans',
  'JetBrains Mono',
  'Playfair Display',
  'Cinzel',
];

interface InspectorPanelProps {
  selectedElement: CanvasElement | null;
  onUpdateElement: (elem: CanvasElement) => void;
  onDeleteElement: (id: string) => void;
  pens: PenDefinition[];
  onAddPen: (pen: PenDefinition) => void;
  onUpdatePen: (pen: PenDefinition) => void;
  onDeletePen: (id: string) => void;
  printerModel: PrinterModel;
  onModelChange: (model: PrinterModel) => void;
  penOffset: PenOffset;
  onOffsetChange: (offset: PenOffset) => void;
  zCalibration: ZCalibration;
  onZCalibrationChange: (cal: ZCalibration) => void;
  quality: QualityPreset;
  onQualityChange: (q: QualityPreset) => void;
  paperBounds: PaperBounds;
  onOpenSetupWizard: () => void;
  onClearCalibration: () => void;
  syncAllSpeeds: boolean;
  onToggleSyncAllSpeeds: (val: boolean) => void;
  globalVectorPrecision: number;
  onGlobalVectorPrecisionChange: (val: number) => void;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedElement,
  onUpdateElement,
  onDeleteElement,
  pens,
  onUpdatePen,
  printerModel,
  onModelChange,
  penOffset,
  onOffsetChange,
  zCalibration,
  onZCalibrationChange,
  quality,
  onQualityChange,
  paperBounds,
  onOpenSetupWizard,
  onClearCalibration,
  syncAllSpeeds,
  onToggleSyncAllSpeeds,
  globalVectorPrecision,
  onGlobalVectorPrecisionChange,
}) => {
  const spec = PRINTER_SPECS[printerModel];

  const zFloor = getZFloor(zCalibration);
  const bedRef = getBedReference(zCalibration);
  const drawZ = getDrawZ(zCalibration);
  const travelZ = getTravelZ(zCalibration);
  const zSafe = isZSafeToPlot(zCalibration);

  const handleCaptureBedReference = () => {
    const result = bambuMachine.captureBedReference();
    if (!result.success) {
      alert(result.error || 'Could not capture the bed reference.');
    }
  };

  // Local fonts detection
  const [detectedSystemFonts, setDetectedSystemFonts] = useState<string[]>([]);
  const [isDetectingFonts, setIsDetectingFonts] = useState<boolean>(false);
  const [isCustomFontMode, setIsCustomFontMode] = useState<boolean>(false);
  const [customFontInput, setCustomFontInput] = useState<string>('');

  // Detect local OS fonts via Local Font Access API if available
  const handleScanLocalFonts = async () => {
    if ('queryLocalFonts' in window) {
      setIsDetectingFonts(true);
      try {
        const fontData = await (window as unknown as { queryLocalFonts: () => Promise<Array<{ family: string }>> }).queryLocalFonts();
        const families = Array.from(new Set(fontData.map((f) => f.family))).sort();
        setDetectedSystemFonts(families);
      } catch (err) {
        console.warn('Local Font Access not granted or unsupported', err);
      } finally {
        setIsDetectingFonts(false);
      }
    }
  };

  // Sync custom font input when selected element changes
  useEffect(() => {
    if (selectedElement?.type === 'text') {
      const fam = selectedElement.fontFamily || 'Arial';
      setCustomFontInput(fam);
      if (!SYSTEM_FONTS_CATALOG.includes(fam) && !detectedSystemFonts.includes(fam)) {
        setIsCustomFontMode(true);
      }
    }
  }, [selectedElement?.id, selectedElement?.fontFamily, detectedSystemFonts]);

  // Combined font list
  const combinedFonts = Array.from(new Set([...SYSTEM_FONTS_CATALOG, ...detectedSystemFonts]));

  // Active quality for selected object
  const currentObjectQuality: QualityPreset =
    (syncAllSpeeds ? quality : selectedElement?.qualityPreset || quality);

  const currentObjectPrecision: number =
    selectedElement?.vectorPrecision !== undefined
      ? selectedElement.vectorPrecision
      : globalVectorPrecision;

  const handleObjectQualitySelect = (newQ: QualityPreset) => {
    if (syncAllSpeeds) {
      onQualityChange(newQ);
    } else if (selectedElement) {
      onUpdateElement({
        ...selectedElement,
        qualityPreset: newQ,
      });
    }
  };

  return (
    <div className="w-[340px] h-full bg-[#10141d] border-l border-[#1e2536] flex flex-col shrink-0 select-none">
      {/* Header */}
      <div className="px-4 py-3 bg-[#0c0f16] border-b border-[#1e2536] flex items-center justify-between">
        <div className="flex items-center gap-2">
          {selectedElement ? (
            <>
              {selectedElement.type === 'text' && <Type className="w-4 h-4 text-emerald-400" />}
              {selectedElement.type === 'circle' && <Circle className="w-4 h-4 text-cyan-400" />}
              {selectedElement.type === 'rect' && <Square className="w-4 h-4 text-cyan-400" />}
              {selectedElement.type === 'line' && <Slash className="w-4 h-4 text-cyan-400" />}
              {selectedElement.type === 'svg' && <Layers className="w-4 h-4 text-purple-400" />}
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                {selectedElement.type === 'text'
                  ? 'Vector Text'
                  : selectedElement.type === 'circle'
                  ? 'Circle Vector'
                  : selectedElement.type === 'rect'
                  ? 'Rectangle Vector'
                  : selectedElement.type === 'line'
                  ? 'Line Vector'
                  : 'SVG Graphic'}
              </span>
            </>
          ) : (
            <>
              <Sliders className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                Bed & Machine Settings
              </span>
            </>
          )}
        </div>

        {selectedElement && (
          <button
            onClick={() => onDeleteElement(selectedElement.id)}
            className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
            title="Delete Selected Object"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Main Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {selectedElement ? (
          // ==========================================
          // OBJECT INSPECTOR (Contextual)
          // ==========================================
          <div className="space-y-4">
            {/* Object Transform: X, Y, Width, Height */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 block">
                Transform (Bed Millimeters)
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">X POS</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max={spec.width}
                    value={Math.round(selectedElement.x)}
                    onChange={(e) =>
                      onUpdateElement({
                        ...selectedElement,
                        x: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1 rounded"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">Y POS</label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max={spec.depth}
                    value={Math.round(selectedElement.y)}
                    onChange={(e) =>
                      onUpdateElement({
                        ...selectedElement,
                        y: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1 rounded"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">WIDTH</label>
                  <input
                    type="number"
                    step="1"
                    min="4"
                    max={spec.width}
                    value={Math.round(selectedElement.width)}
                    onChange={(e) =>
                      onUpdateElement({
                        ...selectedElement,
                        width: Math.max(4, parseFloat(e.target.value) || 10),
                      })
                    }
                    className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1 rounded"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 block mb-0.5">HEIGHT</label>
                  <input
                    type="number"
                    step="1"
                    min="4"
                    max={spec.depth}
                    value={Math.round(selectedElement.height)}
                    onChange={(e) =>
                      onUpdateElement({
                        ...selectedElement,
                        height: Math.max(4, parseFloat(e.target.value) || 10),
                      })
                    }
                    className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1 rounded"
                  />
                </div>
              </div>
            </div>

            {/* TYPOGRAPHY CONTROLS - EXCLUSIVE TO TEXT OBJECTS */}
            {selectedElement.type === 'text' && (
              <div className="p-3 rounded-lg bg-[#0d1017] border border-emerald-500/40 space-y-3">
                <div className="flex items-center justify-between text-emerald-400">
                  <div className="flex items-center gap-1.5">
                    <Type className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Typography Engine
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                    True Vector Outlines
                  </span>
                </div>

                {/* Text Content */}
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">Text Content</label>
                  <textarea
                    rows={2}
                    value={selectedElement.textContent || ''}
                    onChange={(e) =>
                      onUpdateElement({
                        ...selectedElement,
                        textContent: e.target.value,
                        name: e.target.value.split('\n')[0].slice(0, 16) || 'Text',
                      })
                    }
                    className="w-full bg-[#141924] border border-[#263145] text-white px-2.5 py-1.5 rounded text-xs font-mono resize-none focus:outline-hidden focus:border-emerald-500"
                  />
                </div>

                {/* System Font Selector & Custom Font Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] text-slate-400">System Font Family</label>
                    <button
                      type="button"
                      onClick={() => setIsCustomFontMode(!isCustomFontMode)}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors"
                    >
                      {isCustomFontMode ? 'Choose from list' : 'Type custom font'}
                    </button>
                  </div>

                  {isCustomFontMode ? (
                    <div className="space-y-1">
                      <input
                        type="text"
                        placeholder="e.g. Futura, Optima, Calibri, Aptos..."
                        value={customFontInput}
                        onChange={(e) => {
                          setCustomFontInput(e.target.value);
                          if (e.target.value.trim()) {
                            onUpdateElement({
                              ...selectedElement,
                              fontFamily: e.target.value.trim(),
                            });
                          }
                        }}
                        className="w-full bg-[#141924] border border-cyan-500/50 text-white px-2 py-1.5 rounded text-xs"
                      />
                      <span className="text-[9px] text-slate-500 block">
                        Renders any font installed on your operating system
                      </span>
                    </div>
                  ) : (
                    <div className="flex gap-1.5">
                      <select
                        value={selectedElement.fontFamily || 'Arial'}
                        onChange={(e) => {
                          onUpdateElement({
                            ...selectedElement,
                            fontFamily: e.target.value,
                          });
                          setCustomFontInput(e.target.value);
                        }}
                        className="flex-1 bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs truncate"
                      >
                        {combinedFonts.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>

                      {'queryLocalFonts' in window && (
                        <button
                          type="button"
                          onClick={handleScanLocalFonts}
                          disabled={isDetectingFonts}
                          className="px-2 py-1.5 bg-[#172030] hover:bg-[#202c42] text-cyan-300 border border-cyan-500/30 rounded text-xs flex items-center gap-1 shrink-0 transition-colors"
                          title="Scan all fonts installed on this computer"
                        >
                          <Search className="w-3 h-3" />
                          <span className="text-[10px]">{isDetectingFonts ? '...' : 'Scan OS'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Font Size & Line Height */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Font Size (mm)</label>
                    <input
                      type="number"
                      min="4"
                      max="80"
                      value={selectedElement.fontSize || 12}
                      onChange={(e) =>
                        onUpdateElement({
                          ...selectedElement,
                          fontSize: parseFloat(e.target.value) || 12,
                        })
                      }
                      className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs font-mono"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1">Line Spacing</label>
                    <input
                      type="number"
                      step="0.05"
                      min="1.0"
                      max="2.5"
                      value={selectedElement.lineHeight || 1.35}
                      onChange={(e) =>
                        onUpdateElement({
                          ...selectedElement,
                          lineHeight: parseFloat(e.target.value) || 1.35,
                        })
                      }
                      className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Bold, Italic, Underline & Alignment */}
                <div className="flex items-center justify-between p-1 bg-[#141924] border border-[#263145] rounded-lg">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        onUpdateElement({
                          ...selectedElement,
                          isBold: !selectedElement.isBold,
                        })
                      }
                      className={`p-1.5 rounded transition-colors ${
                        selectedElement.isBold
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Bold"
                    >
                      <Bold className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        onUpdateElement({
                          ...selectedElement,
                          isItalic: !selectedElement.isItalic,
                        })
                      }
                      className={`p-1.5 rounded transition-colors ${
                        selectedElement.isItalic
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Italic"
                    >
                      <Italic className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        onUpdateElement({
                          ...selectedElement,
                          isUnderline: !selectedElement.isUnderline,
                        })
                      }
                      className={`p-1.5 rounded transition-colors ${
                        selectedElement.isUnderline
                          ? 'bg-emerald-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Underline"
                    >
                      <Underline className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="w-px h-4 bg-[#263145]" />

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        onUpdateElement({
                          ...selectedElement,
                          textAlign: 'left',
                        })
                      }
                      className={`p-1.5 rounded transition-colors ${
                        selectedElement.textAlign === 'left' || !selectedElement.textAlign
                          ? 'bg-[#1f2838] text-emerald-400'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Align Left"
                    >
                      <AlignLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        onUpdateElement({
                          ...selectedElement,
                          textAlign: 'center',
                        })
                      }
                      className={`p-1.5 rounded transition-colors ${
                        selectedElement.textAlign === 'center'
                          ? 'bg-[#1f2838] text-emerald-400'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Align Center"
                    >
                      <AlignCenter className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        onUpdateElement({
                          ...selectedElement,
                          textAlign: 'right',
                        })
                      }
                      className={`p-1.5 rounded transition-colors ${
                        selectedElement.textAlign === 'right'
                          ? 'bg-[#1f2838] text-emerald-400'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="Align Right"
                    >
                      <AlignRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 3D Print First-Layer Infill Pattern (Applies to ALL vector objects including text) */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 block">
                  3D Print Infill Pattern
                </span>
                <span className="text-[10px] font-mono text-emerald-400">First Layer Style</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {[
                  { id: 'monotonic', label: 'Monotonic', desc: 'Tip-to-tip 45° sweep (Default)' },
                  { id: 'concentric', label: 'Concentric', desc: 'Nested inward rings' },
                  { id: 'rectilinear', label: 'Rectilinear', desc: 'Alternating zigzag' },
                  { id: 'grid', label: 'Grid Matrix', desc: 'Orthogonal 90° cross' },
                  { id: 'outline', label: 'Outline Only', desc: 'Boundary loop only' },
                ].map((pattern) => (
                  <button
                    key={pattern.id}
                    onClick={() =>
                      onUpdateElement({
                        ...selectedElement,
                        fillStyle: pattern.id as InfillPattern,
                      })
                    }
                    className={`p-2 rounded-lg text-left border transition-all ${
                      (selectedElement.fillStyle || 'monotonic') === pattern.id
                        ? 'bg-emerald-950/50 border-emerald-500 text-emerald-300 font-bold'
                        : 'bg-[#121620] border-[#222b3a] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-[11px]">{pattern.label}</div>
                    <div className="text-[9px] text-slate-500">{pattern.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Vector Precision & Resolution Slider */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Vector Precision & Resolution</span>
                </span>
                <span className="text-xs font-mono font-bold text-cyan-400">
                  {currentObjectPrecision} / 10
                </span>
              </div>

              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={currentObjectPrecision}
                onChange={(e) =>
                  onUpdateElement({
                    ...selectedElement,
                    vectorPrecision: parseInt(e.target.value, 10),
                  })
                }
                className="w-full accent-cyan-400 cursor-pointer"
              />

              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>1: Low (Fewer Vertices)</span>
                <span>
                  {currentObjectPrecision <= 3
                    ? 'Draft Resolution'
                    : currentObjectPrecision <= 7
                    ? 'Standard Smooth'
                    : 'Ultra Curve Detail'}
                </span>
                <span>10: Max Curves</span>
              </div>
              <span className="text-[9px] text-slate-500 block">
                Controls vertex density & curve tolerance (~{(0.018 * (11 - currentObjectPrecision)).toFixed(3)}mm)
              </span>
            </div>

            {/* Per-Object Plot Speed & Quality Setting */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Object Quality & Speed</span>
                </span>

                <button
                  onClick={() => onToggleSyncAllSpeeds(!syncAllSpeeds)}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    syncAllSpeeds
                      ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                  title={syncAllSpeeds ? 'Speeds are locked globally' : 'Speed is set independently per object'}
                >
                  {syncAllSpeeds ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                  <span>{syncAllSpeeds ? 'Synced' : 'Per-Object'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {(['low', 'medium', 'normal', 'high'] as QualityPreset[]).map((q) => {
                  const setting = QUALITY_PRESETS[q];
                  const isSelected = currentObjectQuality === q;
                  return (
                    <button
                      key={q}
                      onClick={() => handleObjectQualitySelect(q)}
                      className={`p-2 rounded-lg text-left transition-all border ${
                        isSelected
                          ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold'
                          : 'bg-[#121620] border-[#222b3a] text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-xs font-bold">{setting.name}</div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                        {setting.drawFeedrate / 60} mm/s
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="text-[9px] text-slate-500">
                {syncAllSpeeds
                  ? 'All objects currently share the global speed setting.'
                  : 'Independent speed applied to this vector element.'}
              </div>
            </div>

            {/* Pen Color Assignment */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 block">
                Assigned Pen Color & Tip
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {pens.map((pen) => (
                  <button
                    key={pen.id}
                    onClick={() => onUpdateElement({ ...selectedElement, penId: pen.id })}
                    className={`p-1.5 rounded-lg flex flex-col items-center justify-center gap-1 border transition-all ${
                      selectedElement.penId === pen.id
                        ? 'ring-2 ring-emerald-400 border-transparent bg-[#18202e]'
                        : 'border-[#222b3a] bg-[#121620] hover:border-slate-500'
                    }`}
                    title={`${pen.name} (${pen.diameter}mm)`}
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-black/40 shadow-xs"
                      style={{ backgroundColor: pen.hex }}
                    />
                    <span className="text-[9px] font-mono text-slate-400">
                      {pen.diameter}mm
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // ==========================================
          // DOCUMENT & BED SETUP (When nothing selected)
          // ==========================================
          <div className="space-y-4">
            {/* Bambu Model Switch */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Bambu Printer Model
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onModelChange('A1_MINI')}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-all ${
                    printerModel === 'A1_MINI'
                      ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold'
                      : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className="font-bold">Bambu A1 Mini</div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">180 × 180 mm Bed</div>
                </button>

                <button
                  onClick={() => onModelChange('A1')}
                  className={`p-2.5 rounded-lg border text-left text-xs transition-all ${
                    printerModel === 'A1'
                      ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold'
                      : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className="font-bold">Bambu A1</div>
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">256 × 256 mm Bed</div>
                </button>
              </div>
            </div>

            {/* Global Quality & Speed Setting */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Global Plot Speed & Quality
                </label>
                <button
                  onClick={() => onToggleSyncAllSpeeds(!syncAllSpeeds)}
                  className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors ${
                    syncAllSpeeds
                      ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {syncAllSpeeds ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                  <span>{syncAllSpeeds ? 'Force Shared Speed' : 'Per-Object Speeds'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(['low', 'medium', 'normal', 'high'] as QualityPreset[]).map((q) => {
                  const setting = QUALITY_PRESETS[q];
                  return (
                    <button
                      key={q}
                      onClick={() => onQualityChange(q)}
                      className={`p-2 rounded-lg text-left transition-all border ${
                        quality === q
                          ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold'
                          : 'bg-[#121620] border-[#222b3a] text-slate-400 hover:border-slate-600'
                      }`}
                    >
                      <div className="text-xs font-bold">{setting.name}</div>
                      <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                        {setting.drawFeedrate / 60} mm/s
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Global Default Vector Precision */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Default Vector Precision</span>
                </span>
                <span className="text-xs font-mono font-bold text-cyan-400">
                  {globalVectorPrecision} / 10
                </span>
              </div>

              <input
                type="range"
                min="1"
                max="10"
                step="1"
                value={globalVectorPrecision}
                onChange={(e) => onGlobalVectorPrecisionChange(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400 cursor-pointer"
              />

              <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                <span>1: Low (Fewer Vertices)</span>
                <span>
                  {globalVectorPrecision <= 3
                    ? 'Draft'
                    : globalVectorPrecision <= 7
                    ? 'Standard Smooth'
                    : 'Ultra Precision'}
                </span>
                <span>10: Max Curves</span>
              </div>
            </div>

            {/* Manual Offset Calibration: X 0, Y -29mm */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Hotend-to-Pen Offset
                </span>
                <span className="text-[10px] font-mono text-emerald-400">Bed Slinger Datum</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    X OFFSET (mm)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={penOffset.x}
                    onChange={(e) =>
                      onOffsetChange({ ...penOffset, x: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    Y OFFSET (mm)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={penOffset.y}
                    onChange={(e) =>
                      onOffsetChange({ ...penOffset, y: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            {/* Z Safety — fixed draw plane + pen release */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200 block">
                  Bed Reference & Pen Release
                </span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    zSafe
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-rose-400 bg-rose-500/10'
                  }`}
                >
                  {zSafe ? 'BED LOCKED' : 'NOT CAPTURED'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="p-2 rounded bg-[#141924] border border-[#232f45]">
                  <div className="text-slate-500 uppercase">Bed reference</div>
                  <div className="text-white font-bold text-xs mt-0.5">
                    {bedRef.toFixed(2)} mm
                  </div>
                </div>
                <div className="p-2 rounded bg-[#141924] border border-[#232f45]">
                  <div className="text-slate-500 uppercase">Draw plane</div>
                  <div className="text-emerald-400 font-bold text-xs mt-0.5">
                    {drawZ.toFixed(2)} mm
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  PEN RELEASE HEIGHT ({Z_SAFETY.MIN_PEN_RELEASE_MM}–{Z_SAFETY.MAX_PEN_RELEASE_MM} mm)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={Z_SAFETY.MIN_PEN_RELEASE_MM}
                  max={Z_SAFETY.MAX_PEN_RELEASE_MM}
                  value={zCalibration.penReleaseMm ?? Z_SAFETY.DEFAULT_PEN_RELEASE_MM}
                  onChange={(e) =>
                    onZCalibrationChange({
                      ...zCalibration,
                      penReleaseMm: clampPenRelease(e.target.value),
                    })
                  }
                  className="w-full bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs font-mono"
                />
              </div>

              <div className="text-[10px] font-mono text-slate-400 leading-relaxed">
                Floor {zFloor.toFixed(2)}mm · Draw {drawZ.toFixed(2)}mm · Travel{' '}
                {travelZ.toFixed(2)}mm
                <br />
                Draw plane is fixed at bed + {Z_SAFETY.BED_CLEARANCE_MM.toFixed(1)}mm.
                Pen release is the only adjustable Z value.
              </div>

              {!zSafe && (
                <div className="p-2 rounded bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-300 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Home the printer, jog Z down until it stops at the bed, then capture the
                    bed reference here.
                  </span>
                </div>
              )}

              <button
                onClick={handleCaptureBedReference}
                className="w-full py-1.5 px-2 bg-emerald-700/80 hover:bg-emerald-600 text-white rounded text-[10px] font-semibold flex items-center justify-center gap-1.5"
                title="Capture the current Z as the physical bed reference. No motion."
              >
                <Crosshair className="w-3 h-3" />
                <span>Capture Bed Reference</span>
              </button>
            </div>

            {/* Pen Registry */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-3">
              <span className="text-xs font-semibold text-slate-200 block">
                Pen Swatches & Diameters ({pens.length})
              </span>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {pens.map((pen) => (
                  <div
                    key={pen.id}
                    className="flex items-center justify-between p-1.5 rounded bg-[#141924] border border-[#232f45] text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3.5 h-3.5 rounded-full border border-black/40"
                        style={{ backgroundColor: pen.hex }}
                      />
                      <span className="text-slate-200 font-medium text-[11px]">{pen.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.1"
                        min="0.2"
                        max="3.0"
                        value={pen.diameter}
                        onChange={(e) =>
                          onUpdatePen({
                            ...pen,
                            diameter: parseFloat(e.target.value) || 0.7,
                          })
                        }
                        className="w-12 bg-[#0c0f16] border border-[#263145] text-white px-1 py-0.5 rounded text-[10px] font-mono text-right"
                      />
                      <span className="text-[9px] font-mono text-slate-400">mm</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Setup Wizard Button */}
            <div className="space-y-2 pt-1">
              <button
                onClick={onOpenSetupWizard}
                className="w-full py-2 bg-[#1b2333] hover:bg-[#253047] text-cyan-300 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors border border-cyan-500/30"
              >
                <span>Launch 4-Step Setup Wizard</span>
              </button>
              <button
                onClick={onClearCalibration}
                className="w-full py-1.5 text-xs text-rose-400 hover:text-rose-300 transition-colors"
              >
                Clear Calibration & Paper Bounds
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
