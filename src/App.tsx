import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  PrinterModel,
  PenOffset,
  ZCalibration,
  PaperBounds,
  QualityPreset,
  PenDefinition,
  STANDARD_SOLID_PENS,
  CanvasElement,
  SlicedPlotJob,
  MachineTelemetry,
  PathSegment,
  ActiveTool,
} from './types/plotter';
import { bambuMachine } from './services/bambuService';
import { sliceElementToToolpaths } from './utils/slicerEngine';
import { generateBambuPlotterGcode } from './utils/gcodeGenerator';
import {
  createDefaultZCalibration,
  getZBlockReason,
  isZSafeToPlot,
  normalizeZCalibration,
} from './utils/zSafety';
import { Header } from './components/Header';
import { PlotterCanvas } from './components/PlotterCanvas';
import { VectorToolbar } from './components/VectorToolbar';
import { InspectorPanel } from './components/InspectorPanel';
import { TelemetryDrawer } from './components/TelemetryDrawer';
import { SetupWizardModal } from './components/SetupWizardModal';
import { ColorSwapModal } from './components/ColorSwapModal';
import { ConnectionModal } from './components/ConnectionModal';
import { Sliders, Activity } from 'lucide-react';

export default function App() {
  // Persistent Settings
  const [printerModel, setPrinterModel] = useState<PrinterModel>(() => {
    const saved = localStorage.getItem('bambu_plotter_model');
    return (saved as PrinterModel) || 'A1_MINI';
  });

  const [penOffset, setPenOffset] = useState<PenOffset>(() => {
    const saved = localStorage.getItem('bambu_plotter_offset');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.x === 29 && parsed.y === 0) {
        return { x: 0.0, y: -29.0 };
      }
      return parsed;
    }
    return { x: 0.0, y: -29.0 };
  });

  const [zCalibration, setZCalibration] = useState<ZCalibration>(() => {
    const saved = localStorage.getItem('bambu_plotter_z_cal');
    if (!saved) return createDefaultZCalibration();
    try {
      return normalizeZCalibration(JSON.parse(saved), printerModel);
    } catch (_) {
      return createDefaultZCalibration();
    }
  });

  const [paperBounds, setPaperBounds] = useState<PaperBounds>(() => {
    const saved = localStorage.getItem('bambu_plotter_paper_bounds');
    return saved
      ? JSON.parse(saved)
      : {
          isCalibrated: false,
          topLeft: { x: 20, y: 160 },
          topRight: { x: 160, y: 160 },
          bottomLeft: { x: 20, y: 20 },
          bottomRight: { x: 160, y: 20 },
          widthMm: 140,
          heightMm: 140,
        };
  });

  const [quality, setQuality] = useState<QualityPreset>('normal');
  const [syncAllSpeeds, setSyncAllSpeeds] = useState<boolean>(() => {
    return localStorage.getItem('bambu_plotter_sync_speeds') === 'true';
  });
  const [globalVectorPrecision, setGlobalVectorPrecision] = useState<number>(() => {
    const saved = localStorage.getItem('bambu_plotter_precision');
    return saved ? parseInt(saved, 10) : 7;
  });
  const [pens, setPens] = useState<PenDefinition[]>(() => {
    const saved = localStorage.getItem('bambu_plotter_pens');
    return saved ? JSON.parse(saved) : STANDARD_SOLID_PENS;
  });

  // Active Tool state (Illustrator / Inkscape vector editor style)
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [rightPanelTab, setRightPanelTab] = useState<'inspector' | 'telemetry'>('inspector');

  // Initial Demo Vector Layout (High precision circle + clean vector typography)
  const [elements, setElements] = useState<CanvasElement[]>([
    {
      id: 'demo-circle-1',
      type: 'circle',
      name: 'Precision Circle (Monotonic)',
      penId: 'pen-blue',
      x: 35,
      y: 40,
      width: 50,
      height: 50,
      radius: 25,
      rotation: 0,
      scale: 1,
      fillStyle: 'monotonic', // First-layer 3D-printing monotonic sweep
      vectorPrecision: 7,
      qualityPreset: 'normal',
    },
    {
      id: 'demo-circle-2',
      type: 'circle',
      name: 'Concentric Rings',
      penId: 'pen-red',
      x: 95,
      y: 40,
      width: 50,
      height: 50,
      radius: 25,
      rotation: 0,
      scale: 1,
      fillStyle: 'concentric', // Concentric shrinking circles
      vectorPrecision: 7,
      qualityPreset: 'normal',
    },
    {
      id: 'demo-text-1',
      type: 'text',
      name: 'Title Header',
      penId: 'pen-black',
      x: 25,
      y: 110,
      width: 130,
      height: 35,
      rotation: 0,
      scale: 1,
      fillStyle: 'monotonic', // Text filled by default like 3D printing first-layer!
      textContent: 'Bambu A1 Vector Plotter\nFirst-Layer Precision Engine',
      fontFamily: 'Arial',
      fontSize: 10,
      isBold: true,
      isItalic: false,
      isUnderline: true,
      textAlign: 'left',
      lineHeight: 1.35,
      vectorPrecision: 7,
      qualityPreset: 'normal',
    },
  ]);

  const [selectedElementId, setSelectedElementId] = useState<string | null>('demo-circle-1');

  // Modals
  const [isSetupWizardOpen, setIsSetupWizardOpen] = useState<boolean>(false);
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState<boolean>(false);

  // Machine Telemetry & Drawing Stamping
  const [telemetry, setTelemetry] = useState<MachineTelemetry>(() =>
    bambuMachine.getTelemetry()
  );
  const [drawnLines, setDrawnLines] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    colorHex: string;
    diameter: number;
  }[]>([]);
  const [drawnDots, setDrawnDots] = useState<{
    x: number;
    y: number;
    colorHex: string;
    diameter: number;
  }[]>([]);

  // Sync settings with Bambu Machine Controller
  useEffect(() => {
    bambuMachine.setConfig(printerModel, penOffset, zCalibration, quality);
  }, [printerModel, penOffset, zCalibration, quality]);

  // Accept Z-datum captures / bed probes made inside the machine controller
  useEffect(() => {
    const unsub = bambuMachine.onZCalibrationChanged((cal) => {
      setZCalibration(cal);
      localStorage.setItem('bambu_plotter_z_cal', JSON.stringify(cal));
    });
    return () => {
      unsub();
    };
  }, []);

  // Subscribe to telemetry and live line stamping
  useEffect(() => {
    const unsubTelemetry = bambuMachine.subscribe((tel) => {
      setTelemetry(tel);
      // Auto-switch to telemetry tab when plotting starts
      if (tel.state === 'plotting' || tel.state === 'waiting_pen_change') {
        setRightPanelTab('telemetry');
      }
    });

    const unsubStroke = bambuMachine.onStrokeDrawn((x1, y1, x2, y2, colorHex, diameter) => {
      setDrawnLines((prev) => [...prev, { x1, y1, x2, y2, colorHex, diameter }]);
    });

    const unsubDot = bambuMachine.onDotDrawn((x, y, colorHex, diameter) => {
      setDrawnDots((prev) => [...prev, { x, y, colorHex, diameter }]);
    });

    return () => {
      unsubTelemetry();
      unsubStroke();
      unsubDot();
    };
  }, []);

  // Keyboard Shortcuts (Illustrator standard: V, T, R, C, L, Del, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.key === 'v' || e.key === 'V') setActiveTool('select');
      if (e.key === 't' || e.key === 'T') setActiveTool('text');
      if (e.key === 'r' || e.key === 'R') setActiveTool('rect');
      if (e.key === 'c' || e.key === 'C') setActiveTool('circle');
      if (e.key === 'l' || e.key === 'L') setActiveTool('line');
      if (e.key === 'Escape') setSelectedElementId(null);
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedElementId) {
        setElements((prev) => prev.filter((el) => el.id !== selectedElementId));
        setSelectedElementId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElementId]);

  // Save changes to localStorage
  const handleModelChange = (model: PrinterModel) => {
    setPrinterModel(model);
    localStorage.setItem('bambu_plotter_model', model);
  };

  const handleOffsetChange = (offset: PenOffset) => {
    setPenOffset(offset);
    localStorage.setItem('bambu_plotter_offset', JSON.stringify(offset));
  };

  const handleZCalibrationChange = (zCal: ZCalibration) => {
    const safe = normalizeZCalibration(zCal, printerModel);
    setZCalibration(safe);
    localStorage.setItem('bambu_plotter_z_cal', JSON.stringify(safe));
  };

  const handlePaperBoundsChange = (bounds: PaperBounds) => {
    setPaperBounds(bounds);
    localStorage.setItem('bambu_plotter_paper_bounds', JSON.stringify(bounds));
  };

  const handleClearCalibration = () => {
    const resetZ: ZCalibration = createDefaultZCalibration();
    const resetBounds: PaperBounds = {
      isCalibrated: false,
      topLeft: { x: 20, y: 160 },
      topRight: { x: 160, y: 160 },
      bottomLeft: { x: 20, y: 20 },
      bottomRight: { x: 160, y: 20 },
      widthMm: 140,
      heightMm: 140,
    };
    setZCalibration(resetZ);
    setPaperBounds(resetBounds);
    localStorage.removeItem('bambu_plotter_z_cal');
    localStorage.removeItem('bambu_plotter_paper_bounds');
  };

  const handleAddPen = (pen: PenDefinition) => {
    const updated = [...pens, pen];
    setPens(updated);
    localStorage.setItem('bambu_plotter_pens', JSON.stringify(updated));
  };

  const handleUpdatePen = (updatedPen: PenDefinition) => {
    const updated = pens.map((p) => (p.id === updatedPen.id ? updatedPen : p));
    setPens(updated);
    localStorage.setItem('bambu_plotter_pens', JSON.stringify(updated));
  };

  const handleDeletePen = (id: string) => {
    if (pens.length <= 1) return;
    const updated = pens.filter((p) => p.id !== id);
    setPens(updated);
    localStorage.setItem('bambu_plotter_pens', JSON.stringify(updated));
  };

  // Speed & Precision Sync handlers
  const handleQualityChange = (newQ: QualityPreset) => {
    setQuality(newQ);
    if (syncAllSpeeds) {
      setElements((prev) => prev.map((el) => ({ ...el, qualityPreset: newQ })));
    }
  };

  const handleToggleSyncAllSpeeds = (val: boolean) => {
    setSyncAllSpeeds(val);
    localStorage.setItem('bambu_plotter_sync_speeds', String(val));
    if (val) {
      setElements((prev) => prev.map((el) => ({ ...el, qualityPreset: quality })));
    }
  };

  const handleGlobalVectorPrecisionChange = (val: number) => {
    setGlobalVectorPrecision(val);
    localStorage.setItem('bambu_plotter_precision', String(val));
  };

  // Canvas element management
  const handleAddElement = (elem: CanvasElement) => {
    const finalized: CanvasElement = {
      ...elem,
      vectorPrecision: elem.vectorPrecision ?? globalVectorPrecision,
      qualityPreset: elem.qualityPreset ?? quality,
    };
    setElements((prev) => [...prev, finalized]);
    setSelectedElementId(finalized.id);
    setRightPanelTab('inspector');
  };

  const handleUpdateElement = (updatedElem: CanvasElement) => {
    setElements((prev) => prev.map((el) => (el.id === updatedElem.id ? updatedElem : el)));
  };

  const handleDeleteElement = (id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (selectedElementId === id) setSelectedElementId(null);
  };

  // SVG file upload from toolbar
  const handleUploadSvg = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          const newSvgElem: CanvasElement = {
            id: `svg-${Date.now()}`,
            type: 'svg',
            name: file.name.replace(/\.svg$/i, '') || 'Imported Vector',
            penId: pens[0]?.id || 'pen-black',
            x: 40,
            y: 40,
            width: 60,
            height: 60,
            rotation: 0,
            scale: 1,
            fillStyle: 'outline',
            svgString: content,
          };
          handleAddElement(newSvgElem);
        }
      };
      reader.readAsText(file);
    }
  };

  // Slice elements into ordered toolpaths using 3D print first layer slicing
  const slicedJob = useMemo<SlicedPlotJob | null>(() => {
    if (elements.length === 0) return null;

    const layersMap = new Map<string, PathSegment[]>();

    for (const elem of elements) {
      const pen = pens.find((p) => p.id === elem.penId) || pens[0];
      const segments = sliceElementToToolpaths(elem, pen);

      // Offset points by element's (x, y) on the bed
      const translated = segments.map((seg) => ({
        ...seg,
        points: seg.points.map((pt) => ({
          x: Math.round((pt.x + elem.x) * 100) / 100,
          y: Math.round((pt.y + elem.y) * 100) / 100,
        })),
      }));

      const existing = layersMap.get(pen.id) || [];
      layersMap.set(pen.id, [...existing, ...translated]);
    }

    let totalLengthMm = 0;
    let totalTravelMm = 0;
    const layersByPen: SlicedPlotJob['layersByPen'] = [];

    layersMap.forEach((segments, penId) => {
      const pen = pens.find((p) => p.id === penId) || pens[0];
      let penLength = 0;

      for (const seg of segments) {
        for (let i = 1; i < seg.points.length; i++) {
          penLength += Math.hypot(
            seg.points[i].x - seg.points[i - 1].x,
            seg.points[i].y - seg.points[i - 1].y
          );
        }
      }

      totalLengthMm += penLength;
      layersByPen.push({
        pen,
        strokeSegments: segments,
        totalPenLengthMm: Math.round(penLength * 10) / 10,
      });
    });

    const estSec = Math.round(totalLengthMm / 40 + layersByPen.length * 20 + 5);

    return {
      id: `job-${Date.now()}`,
      totalLengthMm: Math.round(totalLengthMm),
      totalTravelMm: Math.round(totalTravelMm),
      estimatedSeconds: estSec,
      layersByPen,
    };
  }, [elements, pens]);

  // Start Plotting
  const handleStartPlot = () => {
    if (!slicedJob) return;
    const blockReason = getZBlockReason(zCalibration);
    if (!isZSafeToPlot(zCalibration)) {
      alert(`SAFETY BLOCK: ${blockReason || 'Z datum is not valid.'}`);
      return;
    }
    setDrawnLines([]);
    setDrawnDots([]);
    setRightPanelTab('telemetry');
    bambuMachine.startPlot(slicedJob);
  };

  // Export G-Code
  const handleExportGcode = () => {
    if (!slicedJob) return;
    const blockReason = getZBlockReason(zCalibration);
    if (!isZSafeToPlot(zCalibration)) {
      alert(`SAFETY BLOCK: ${blockReason || 'Z datum is not valid.'}`);
      return;
    }
    const res = generateBambuPlotterGcode({
      model: printerModel,
      job: slicedJob,
      penOffset,
      zCalibration,
      quality,
      paperBounds,
      syncAllSpeeds,
    });

    if (res.warnings.length > 0) {
      console.warn('[G-code export warnings]', res.warnings);
    }

    const blob = new Blob([res.gcode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `bambu_plot_${printerModel.toLowerCase()}_${Date.now()}.gcode`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const selectedElement = elements.find((el) => el.id === selectedElementId) || null;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0b0e14] text-slate-100">
      {/* Universal Top Bar */}
      <Header
        printerModel={printerModel}
        onModelChange={handleModelChange}
        connectionMode={telemetry.connectionMode}
        machineState={telemetry.state}
        onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
        onOpenConnectionModal={() => setIsConnectionModalOpen(true)}
        onExportGcode={handleExportGcode}
        onStartPlot={handleStartPlot}
        isReadyToPlot={elements.length > 0 && telemetry.state !== 'plotting'}
        elementCount={elements.length}
      />

      {/* Main Workspace Console (Illustrator / Inkscape Architecture) */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Vector Creation Tool Palette (Select, Text, Rect, Circle, Line, SVG) */}
        <VectorToolbar
          activeTool={activeTool}
          onSelectTool={setActiveTool}
          onUploadSvg={handleUploadSvg}
          onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
          onOpenConnectionModal={() => setIsConnectionModalOpen(true)}
          connectionMode={telemetry.connectionMode}
        />

        {/* Center Stage: Interactive Millimeter Bed Canvas */}
        <PlotterCanvas
          printerModel={printerModel}
          paperBounds={paperBounds}
          penOffset={penOffset}
          elements={elements}
          selectedElementId={selectedElementId}
          onSelectElement={(id) => {
            setSelectedElementId(id);
            if (id) setRightPanelTab('inspector');
          }}
          onAddElement={handleAddElement}
          onUpdateElement={handleUpdateElement}
          onDeleteElement={handleDeleteElement}
          pens={pens}
          slicedJob={slicedJob}
          hotendPos={telemetry.hotendPos}
          penPos={telemetry.penPos}
          drawnLines={drawnLines}
          drawnDots={drawnDots}
          activeTool={activeTool}
          onToolChange={setActiveTool}
        />

        {/* Right Column: Docked Inspector & Telemetry with Seamless Tab Switch */}
        <div className="flex flex-col h-full bg-[#10141d] border-l border-[#1e2536] shrink-0">
          {/* Segmented Tab Switch between Inspector and Machine Telemetry */}
          <div className="flex items-center p-1.5 bg-[#0c0f16] border-b border-[#1e2536] gap-1 shrink-0">
            <button
              onClick={() => setRightPanelTab('inspector')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors ${
                rightPanelTab === 'inspector'
                  ? 'bg-[#1a2333] text-emerald-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Inspector</span>
            </button>
            <button
              onClick={() => setRightPanelTab('telemetry')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-colors ${
                rightPanelTab === 'telemetry'
                  ? 'bg-[#1a2333] text-emerald-400 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Telemetry</span>
            </button>
          </div>

          {/* Panel Views */}
          <div className="flex-1 overflow-hidden">
            {rightPanelTab === 'inspector' ? (
              <InspectorPanel
                selectedElement={selectedElement}
                onUpdateElement={handleUpdateElement}
                onDeleteElement={handleDeleteElement}
                pens={pens}
                onAddPen={handleAddPen}
                onUpdatePen={handleUpdatePen}
                onDeletePen={handleDeletePen}
                printerModel={printerModel}
                onModelChange={handleModelChange}
                penOffset={penOffset}
                onOffsetChange={handleOffsetChange}
                zCalibration={zCalibration}
                onZCalibrationChange={handleZCalibrationChange}
                quality={quality}
                onQualityChange={handleQualityChange}
                paperBounds={paperBounds}
                onOpenSetupWizard={() => setIsSetupWizardOpen(true)}
                onClearCalibration={handleClearCalibration}
                syncAllSpeeds={syncAllSpeeds}
                onToggleSyncAllSpeeds={handleToggleSyncAllSpeeds}
                globalVectorPrecision={globalVectorPrecision}
                onGlobalVectorPrecisionChange={handleGlobalVectorPrecisionChange}
              />
            ) : (
              <TelemetryDrawer
                telemetry={telemetry}
                printerModel={printerModel}
                penOffset={penOffset}
                onEmergencyStop={() => bambuMachine.abortPlot()}
                onPause={() => bambuMachine.pausePlot()}
                onResume={() => bambuMachine.resumePlot()}
              />
            )}
          </div>
        </div>
      </div>

      {/* One-Time Setup Wizard Modal */}
      <SetupWizardModal
        isOpen={isSetupWizardOpen}
        onClose={() => setIsSetupWizardOpen(false)}
        printerModel={printerModel}
        penOffset={penOffset}
        zCalibration={zCalibration}
        paperBounds={paperBounds}
        onSaveZCalibration={handleZCalibrationChange}
        onSavePaperBounds={handlePaperBoundsChange}
        onClearCalibration={handleClearCalibration}
        currentPenPos={telemetry.penPos}
      />

      {/* Color Swap Modal with Mandatory Z-Homing Safeguard */}
      <ColorSwapModal
        isOpen={telemetry.state === 'waiting_pen_change'}
        nextPen={telemetry.pendingColorChange?.nextPen || null}
        penIndex={telemetry.pendingColorChange?.penIndex || 0}
        totalPens={telemetry.pendingColorChange?.totalPens || 1}
        onResume={() => bambuMachine.resumePlotAfterColorSwap()}
        onAbort={() => bambuMachine.abortPlot()}
      />

      {/* Bambu Connection Modal */}
      <ConnectionModal
        isOpen={isConnectionModalOpen}
        onClose={() => setIsConnectionModalOpen(false)}
        connectionMode={telemetry.connectionMode}
        onSaveConnection={(mode, config) => {
          if (mode === 'simulator') {
            bambuMachine.connectSimulator();
          } else if (config) {
            bambuMachine.connectMqtt(config.ip, config.serialNumber);
          }
        }}
      />
    </div>
  );
}
