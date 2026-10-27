import React, { useState } from 'react';
import {
  CanvasElement,
  PenDefinition,
  STANDARD_SOLID_PENS,
  PrinterModel,
  PRINTER_SPECS,
  PenOffset,
  ZCalibration,
  QualityPreset,
  QUALITY_PRESETS,
  FillStyle,
  PaperBounds,
} from '../types/plotter';
import {
  Type,
  Upload,
  Palette,
  Sliders,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Plus,
  Trash2,
  Wand2,
  FileCode,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import {
  Z_SAFETY,
  clampPenRelease,
  getBedReference,
  getDrawZ,
  getTravelZ,
} from '../utils/zSafety';

interface DesignSidebarProps {
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
  pens: PenDefinition[];
  onAddPen: (pen: PenDefinition) => void;
  onUpdatePen: (pen: PenDefinition) => void;
  onDeletePen: (id: string) => void;
  elements: CanvasElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onAddElement: (elem: CanvasElement) => void;
  onUpdateElement: (elem: CanvasElement) => void;
  onDeleteElement: (id: string) => void;
}

export const DesignSidebar: React.FC<DesignSidebarProps> = ({
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
  pens,
  onAddPen,
  onUpdatePen,
  onDeletePen,
  elements,
  selectedElementId,
  onSelectElement,
  onAddElement,
  onUpdateElement,
  onDeleteElement,
}) => {
  const [activeTab, setActiveTab] = useState<'text' | 'svg' | 'pens' | 'machine'>('text');

  // Text builder state
  const [textContent, setTextContent] = useState<string>(
    'Bambu A1 Pen Plotter\nPrecision Engineering\nVector Path Calibration'
  );
  const [fontFamily, setFontFamily] = useState<string>('Plus Jakarta Sans');
  const [fontSize, setFontSize] = useState<number>(14);
  const [isBold, setIsBold] = useState<boolean>(true);
  const [isItalic, setIsItalic] = useState<boolean>(false);
  const [isUnderline, setIsUnderline] = useState<boolean>(false);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [textFillStyle, setTextFillStyle] = useState<FillStyle>('outline');
  const [textPenId, setTextPenId] = useState<string>(pens[0]?.id || 'pen-black');

  // SVG import state
  const [svgInputText, setSvgInputText] = useState<string>('');
  const [svgName, setSvgName] = useState<string>('Custom Vector');
  const [svgWidth, setSvgWidth] = useState<number>(60);
  const [svgHeight, setSvgHeight] = useState<number>(60);
  const [svgFillStyle, setSvgFillStyle] = useState<FillStyle>('outline');
  const [svgPenId, setSvgPenId] = useState<string>(pens[1]?.id || pens[0]?.id || 'pen-red');

  // Custom pen creation state
  const [newPenName, setNewPenName] = useState<string>('New Pen');
  const [newPenHex, setNewPenHex] = useState<string>('#16a34a');
  const [newPenDiameter, setNewPenDiameter] = useState<number>(0.7);

  const spec = PRINTER_SPECS[printerModel];
  const bedRef = getBedReference(zCalibration);
  const drawZ = getDrawZ(zCalibration);
  const travelZ = getTravelZ(zCalibration);

  // Selected element synchronization
  const selectedElement = elements.find((el) => el.id === selectedElementId);

  const handleAddTextElement = () => {
    if (!textContent.trim()) return;

    // Default positioning in paper bounds or bed center
    const posX = paperBounds.isCalibrated ? paperBounds.bottomLeft.x + 10 : 25;
    const posY = paperBounds.isCalibrated ? paperBounds.bottomLeft.y + 20 : 30;

    const newElem: CanvasElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      name: textContent.split('\n')[0].slice(0, 18) || 'Paragraph Text',
      penId: textPenId,
      x: posX,
      y: posY,
      width: Math.min(120, spec.width - posX - 10),
      height: 45,
      rotation: 0,
      scale: 1,
      fillStyle: textFillStyle,
      textContent,
      fontFamily,
      fontSize,
      isBold,
      isItalic,
      isUnderline,
      textAlign,
      lineHeight: 1.3,
    };

    onAddElement(newElem);
    onSelectElement(newElem.id);
  };

  const handleImportSvg = (svgStr: string, name?: string) => {
    if (!svgStr.trim()) return;

    const posX = paperBounds.isCalibrated ? paperBounds.bottomLeft.x + 15 : 30;
    const posY = paperBounds.isCalibrated ? paperBounds.bottomLeft.y + 15 : 30;

    const newElem: CanvasElement = {
      id: `svg-${Date.now()}`,
      type: 'svg',
      name: name || svgName || 'Imported Vector',
      penId: svgPenId,
      x: posX,
      y: posY,
      width: svgWidth,
      height: svgHeight,
      rotation: 0,
      scale: 1,
      fillStyle: svgFillStyle,
      svgString: svgStr,
    };

    onAddElement(newElem);
    onSelectElement(newElem.id);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          handleImportSvg(content, file.name.replace(/\.svg$/i, ''));
        }
      };
      reader.readAsText(file);
    }
  };

  // Sample SVGs for instant one-click testing
  const loadPresetSvg = (type: 'bambu' | 'mandala' | 'botanical' | 'gear') => {
    if (type === 'bambu') {
      const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M20,15 L45,15 L35,85 L10,85 Z" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M55,15 L80,15 L70,85 L45,85 Z" fill="none" stroke="currentColor" stroke-width="2"/>
        <line x1="20" y1="50" x2="80" y2="50" stroke="currentColor" stroke-width="2"/>
      </svg>`;
      handleImportSvg(svg, 'Bambu Geometric Mark');
    } else if (type === 'mandala') {
      const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" stroke-width="1"/>
        <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" stroke-width="1"/>
        <polygon points="50,8 86,50 50,92 14,50" fill="none" stroke="currentColor" stroke-width="1"/>
        <polygon points="20,20 80,20 80,80 20,80" fill="none" stroke="currentColor" stroke-width="1"/>
      </svg>`;
      handleImportSvg(svg, 'Geometric Mandala');
    } else if (type === 'botanical') {
      const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <path d="M50,90 Q50,50 50,10" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M50,70 Q75,60 80,45 Q65,45 50,60" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <path d="M50,50 Q25,40 20,25 Q35,25 50,40" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <path d="M50,30 Q70,20 75,5 Q60,8 50,20" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>`;
      handleImportSvg(svg, 'Botanical Branch');
    } else if (type === 'gear') {
      const svg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="16" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M46,6 L54,6 L56,16 L44,16 Z M46,84 L54,84 L56,94 L44,94 Z M6,46 L6,54 L16,56 L16,44 Z M84,46 L84,54 L94,56 L94,44 Z" fill="none" stroke="currentColor" stroke-width="1.5"/>
      </svg>`;
      handleImportSvg(svg, 'Precision Caliper Gear');
    }
  };

  return (
    <div className="w-[360px] h-full bg-[#10141d] border-r border-[#1e2536] flex flex-col shrink-0 select-none">
      {/* Sidebar Navigation Tabs */}
      <div className="flex items-center border-b border-[#1e2536] bg-[#0c0f16]">
        <button
          onClick={() => setActiveTab('text')}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'text'
              ? 'border-emerald-500 text-emerald-400 bg-[#141924]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Type className="w-3.5 h-3.5" />
          <span>Text Studio</span>
        </button>

        <button
          onClick={() => setActiveTab('svg')}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'svg'
              ? 'border-emerald-500 text-emerald-400 bg-[#141924]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>SVG Import</span>
        </button>

        <button
          onClick={() => setActiveTab('pens')}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'pens'
              ? 'border-emerald-500 text-emerald-400 bg-[#141924]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Palette className="w-3.5 h-3.5" />
          <span>Pens ({pens.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('machine')}
          className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border-b-2 ${
            activeTab === 'machine'
              ? 'border-emerald-500 text-emerald-400 bg-[#141924]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Offsets</span>
        </button>
      </div>

      {/* Tab Panels */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TEXT STUDIO TAB */}
        {activeTab === 'text' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Multi-Line Paragraph Input
              </label>
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                rows={4}
                placeholder="Type multiple lines, poetry, calligraphy, or labels..."
                className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg p-2.5 text-xs font-mono focus:outline-hidden focus:border-emerald-500 resize-none"
              />
            </div>

            {/* Typography Controls */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Font Family
                </label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-2.5 py-1.5 text-xs focus:outline-hidden focus:border-emerald-500"
                >
                  <option value="Plus Jakarta Sans">Plus Jakarta (Modern)</option>
                  <option value="JetBrains Mono">JetBrains (Technical Mono)</option>
                  <option value="Playfair Display">Playfair (Serif Editorial)</option>
                  <option value="Cinzel">Cinzel (Roman Classical)</option>
                  <option value="cursive">Calligraphic Script</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Size (mm)
                </label>
                <input
                  type="number"
                  min="4"
                  max="60"
                  value={fontSize}
                  onChange={(e) => setFontSize(parseFloat(e.target.value) || 12)}
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-2.5 py-1.5 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                />
              </div>
            </div>

            {/* Formatting Buttons (Bold, Italic, Underline, Alignment) */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                Styling & Alignment
              </label>
              <div className="flex items-center justify-between p-1 bg-[#0b0e14] border border-[#232b3b] rounded-lg">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setIsBold((b) => !b)}
                    className={`p-1.5 rounded transition-colors ${
                      isBold ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Bold"
                  >
                    <Bold className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsItalic((i) => !i)}
                    className={`p-1.5 rounded transition-colors ${
                      isItalic ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Italic"
                  >
                    <Italic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsUnderline((u) => !u)}
                    className={`p-1.5 rounded transition-colors ${
                      isUnderline ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Underline"
                  >
                    <Underline className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="w-px h-4 bg-[#232b3b]" />

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setTextAlign('left')}
                    className={`p-1.5 rounded transition-colors ${
                      textAlign === 'left' ? 'bg-[#1e2638] text-emerald-400' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Align Left"
                  >
                    <AlignLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setTextAlign('center')}
                    className={`p-1.5 rounded transition-colors ${
                      textAlign === 'center' ? 'bg-[#1e2638] text-emerald-400' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Align Center"
                  >
                    <AlignCenter className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setTextAlign('right')}
                    className={`p-1.5 rounded transition-colors ${
                      textAlign === 'right' ? 'bg-[#1e2638] text-emerald-400' : 'text-slate-400 hover:text-white'
                    }`}
                    title="Align Right"
                  >
                    <AlignRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Stylized Fill Mode Selection */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                Stylized Infill Drawing Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'outline', label: 'Outlines Only (No Fill)' },
                  { id: 'hatch', label: 'Parallel Hatching' },
                  { id: 'crosshatch', label: 'Cross-Hatched' },
                  { id: 'stipple', label: 'Stipple (Dot Pecking)' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setTextFillStyle(mode.id as FillStyle)}
                    className={`p-2 rounded-lg text-left text-xs transition-all border ${
                      textFillStyle === mode.id
                        ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold'
                        : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Assign Pen Slot */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                Assign Pen Color & Tip
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {pens.map((pen) => (
                  <button
                    key={pen.id}
                    onClick={() => setTextPenId(pen.id)}
                    className={`p-1.5 rounded-lg flex flex-col items-center justify-center gap-1 border transition-all ${
                      textPenId === pen.id
                        ? 'ring-2 ring-emerald-400 border-transparent bg-[#18202e]'
                        : 'border-[#222b3a] bg-[#0d1017] hover:border-slate-500'
                    }`}
                    title={`${pen.name} (${pen.diameter}mm)`}
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-black/40 shadow-sm"
                      style={{ backgroundColor: pen.hex }}
                    />
                    <span className="text-[9px] font-mono text-slate-400">
                      {pen.diameter}mm
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleAddTextElement}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-lg shadow-emerald-950/30 flex items-center justify-center gap-2 transition-all mt-2"
            >
              <Plus className="w-4 h-4" />
              <span>Add Formatted Text to Bed</span>
            </button>
          </div>
        )}

        {/* SVG IMPORT TAB */}
        {activeTab === 'svg' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Import Vector File (.SVG)
              </label>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-[#2b3547] hover:border-emerald-500 bg-[#0b0e14] rounded-lg p-5 cursor-pointer transition-colors group">
                <Upload className="w-7 h-7 text-slate-500 group-hover:text-emerald-400 mb-1.5 transition-colors" />
                <span className="text-xs font-medium text-slate-300">Click to upload SVG vector</span>
                <span className="text-[10px] text-slate-500 mt-0.5">Supports paths, polylines, rects, circles</span>
                <input
                  type="file"
                  accept=".svg,image/svg+xml"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            {/* Ready-to-Test Presets */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                Or Select High-Precision Presets
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => loadPresetSvg('bambu')}
                  className="p-2.5 rounded-lg bg-[#0d1017] border border-[#222b3a] hover:border-emerald-500 text-left text-xs text-slate-300 transition-colors flex items-center gap-2"
                >
                  <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Bambu Mark</span>
                </button>
                <button
                  onClick={() => loadPresetSvg('mandala')}
                  className="p-2.5 rounded-lg bg-[#0d1017] border border-[#222b3a] hover:border-emerald-500 text-left text-xs text-slate-300 transition-colors flex items-center gap-2"
                >
                  <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Mandala Art</span>
                </button>
                <button
                  onClick={() => loadPresetSvg('botanical')}
                  className="p-2.5 rounded-lg bg-[#0d1017] border border-[#222b3a] hover:border-emerald-500 text-left text-xs text-slate-300 transition-colors flex items-center gap-2"
                >
                  <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Botanical Leaf</span>
                </button>
                <button
                  onClick={() => loadPresetSvg('gear')}
                  className="p-2.5 rounded-lg bg-[#0d1017] border border-[#222b3a] hover:border-emerald-500 text-left text-xs text-slate-300 transition-colors flex items-center gap-2"
                >
                  <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Precision Gear</span>
                </button>
              </div>
            </div>

            {/* Dimensions */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Target Width (mm)
                </label>
                <input
                  type="number"
                  min="10"
                  max={spec.width}
                  value={svgWidth}
                  onChange={(e) => setSvgWidth(parseFloat(e.target.value) || 40)}
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-400 mb-1">
                  Target Height (mm)
                </label>
                <input
                  type="number"
                  min="10"
                  max={spec.depth}
                  value={svgHeight}
                  onChange={(e) => setSvgHeight(parseFloat(e.target.value) || 40)}
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            {/* Stylized Fill Mode */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                Stylized Infill Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'outline', label: 'Outlines Only' },
                  { id: 'hatch', label: 'Parallel Hatching' },
                  { id: 'crosshatch', label: 'Cross-Hatched' },
                  { id: 'stipple', label: 'Stippled Dots' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setSvgFillStyle(mode.id as FillStyle)}
                    className={`p-2 rounded-lg text-left text-xs transition-all border ${
                      svgFillStyle === mode.id
                        ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold'
                        : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pen Color */}
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1.5">
                Assign Pen Color
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {pens.map((pen) => (
                  <button
                    key={pen.id}
                    onClick={() => setSvgPenId(pen.id)}
                    className={`p-1.5 rounded-lg flex flex-col items-center justify-center gap-1 border transition-all ${
                      svgPenId === pen.id
                        ? 'ring-2 ring-emerald-400 border-transparent bg-[#18202e]'
                        : 'border-[#222b3a] bg-[#0d1017] hover:border-slate-500'
                    }`}
                    title={`${pen.name} (${pen.diameter}mm)`}
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-black/40 shadow-sm"
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
        )}

        {/* PENS & MULTI-COLOR TAB */}
        {activeTab === 'pens' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Solid Pen Registry
                </h3>
                <p className="text-[11px] text-slate-400">
                  Non-gradient solid markers with custom point diameters
                </p>
              </div>
            </div>

            {/* Pen List */}
            <div className="space-y-2">
              {pens.map((pen) => (
                <div
                  key={pen.id}
                  className="p-2.5 rounded-lg bg-[#0d1017] border border-[#222b3a] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-5 h-5 rounded-full border border-white/20 shadow-sm shrink-0"
                      style={{ backgroundColor: pen.hex }}
                    />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{pen.name}</div>
                      <div className="text-[10px] font-mono text-slate-400">
                        {pen.diameter}mm · {pen.penType}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="0.2"
                      max="3.0"
                      value={pen.diameter}
                      onChange={(e) =>
                        onUpdatePen({ ...pen, diameter: parseFloat(e.target.value) || 0.7 })
                      }
                      className="w-14 bg-[#141924] border border-[#263145] text-white px-1.5 py-1 rounded text-[11px] font-mono text-right"
                      title="Custom Pen Diameter (mm)"
                    />
                    <span className="text-[10px] font-mono text-slate-500">mm</span>
                    {pens.length > 1 && (
                      <button
                        onClick={() => onDeletePen(pen.id)}
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                        title="Remove Pen"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Custom Pen */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-3">
              <span className="text-xs font-semibold text-slate-300 block">Add Custom Marker</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Marker Name"
                  value={newPenName}
                  onChange={(e) => setNewPenName(e.target.value)}
                  className="bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={newPenHex}
                    onChange={(e) => setNewPenHex(e.target.value)}
                    className="w-8 h-8 rounded bg-transparent cursor-pointer"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0.2"
                    max="5.0"
                    value={newPenDiameter}
                    onChange={(e) => setNewPenDiameter(parseFloat(e.target.value) || 0.7)}
                    className="w-16 bg-[#141924] border border-[#263145] text-white px-2 py-1.5 rounded text-xs font-mono text-right"
                    title="Point diameter (mm)"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  onAddPen({
                    id: `pen-${Date.now()}`,
                    name: newPenName || 'Custom Pen',
                    hex: newPenHex,
                    diameter: newPenDiameter,
                    penType: 'custom',
                    isEnabled: true,
                  });
                  setNewPenName('New Pen');
                }}
                className="w-full py-1.5 bg-[#1e2638] hover:bg-[#28344c] text-slate-200 text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Marker to Tray</span>
              </button>
            </div>
          </div>
        )}

        {/* MACHINE & OFFSET TAB */}
        {activeTab === 'machine' && (
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

            {/* Manual Offset Calibration: Default X 0, Y -29mm */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Hotend-to-Pen Offset
                </span>
                <span className="text-[10px] font-mono text-cyan-400">Default: X 0, Y -29mm</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Physical distance between nozzle and marker clamp tip (Pen sits 29mm in front of the nozzle along the Y bed slinger). Inverted kinematic compensation is applied automatically.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    X OFFSET (MM)
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
                    Y OFFSET (MM)
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

            {/* Fixed draw plane + pen release */}
            <div className="p-3 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-3">
              <span className="text-xs font-semibold text-slate-200 block">
                Bed Reference & Pen Release
              </span>
              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <div className="p-2 rounded bg-[#141924] border border-[#232f45]">
                  <div className="text-slate-500 uppercase">Bed</div>
                  <div className="text-white font-bold text-xs mt-0.5">{bedRef.toFixed(2)} mm</div>
                </div>
                <div className="p-2 rounded bg-[#141924] border border-[#232f45]">
                  <div className="text-slate-500 uppercase">Draw plane</div>
                  <div className="text-emerald-400 font-bold text-xs mt-0.5">{drawZ.toFixed(2)} mm</div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-mono text-slate-400 mb-1">
                  PEN RELEASE ({Z_SAFETY.MIN_PEN_RELEASE_MM}–{Z_SAFETY.MAX_PEN_RELEASE_MM} mm)
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
              <p className="text-[10px] font-mono text-slate-500">
                Draw is fixed at bed + {Z_SAFETY.BED_CLEARANCE_MM.toFixed(1)}mm · Travel {travelZ.toFixed(2)}mm
              </p>
            </div>

            {/* Quality Presets */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
                Plot Speed & Quality Preset
              </label>
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
                          : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
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

            {/* Calibration Wizard Quick Launch & Reset */}
            <div className="space-y-2 pt-2">
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
