import React, { useRef, useState, useEffect } from 'react';
import {
  PrinterModel,
  PRINTER_SPECS,
  PaperBounds,
  PenOffset,
  CanvasElement,
  PenDefinition,
  SlicedPlotJob,
  ActiveTool,
} from '../types/plotter';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Trash2,
} from 'lucide-react';

interface PlotterCanvasProps {
  printerModel: PrinterModel;
  paperBounds: PaperBounds;
  penOffset: PenOffset;
  elements: CanvasElement[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onAddElement: (elem: CanvasElement) => void;
  onUpdateElement: (elem: CanvasElement) => void;
  onDeleteElement: (id: string) => void;
  pens: PenDefinition[];
  slicedJob: SlicedPlotJob | null;
  hotendPos: { x: number; y: number; z: number };
  penPos: { x: number; y: number; z: number };
  drawnLines: { x1: number; y1: number; x2: number; y2: number; colorHex: string; diameter: number }[];
  drawnDots: { x: number; y: number; colorHex: string; diameter: number }[];
  activeTool: ActiveTool;
  onToolChange: (tool: ActiveTool) => void;
}

export const PlotterCanvas: React.FC<PlotterCanvasProps> = ({
  printerModel,
  paperBounds,
  penOffset,
  elements,
  selectedElementId,
  onSelectElement,
  onAddElement,
  onUpdateElement,
  onDeleteElement,
  pens,
  slicedJob,
  hotendPos,
  penPos,
  drawnLines,
  drawnDots,
  activeTool,
  onToolChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const spec = PRINTER_SPECS[printerModel];

  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(2.2);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState<boolean>(true);

  // Dragging / moving element state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Shape creation interactive drawing state
  const [isDrawingShape, setIsDrawingShape] = useState<boolean>(false);
  const [drawStartBed, setDrawStartBed] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [drawCurrentBed, setDrawCurrentBed] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isSpaceHeld, setIsSpaceHeld] = useState<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        setIsSpaceHeld(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Center canvas on mount or model change
  useEffect(() => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const initialZoom = Math.min(
        (clientWidth - 100) / spec.width,
        (clientHeight - 100) / spec.depth,
        2.5
      );
      setZoom(initialZoom);
      setPan({
        x: (clientWidth - spec.width * initialZoom) / 2,
        y: (clientHeight - spec.depth * initialZoom) / 2,
      });
    }
  }, [printerModel, spec.width, spec.depth]);

  const getBedCoords = (clientX: number, clientY: number): { x: number; y: number } => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const canvasX = (clientX - rect.left - pan.x) / zoom;
    // Invert Y coordinate since printer bed 0 is at bottom (front of bed)
    const canvasY = spec.depth - (clientY - rect.top - pan.y) / zoom;
    return {
      x: Math.max(0, Math.min(spec.width, Math.round(canvasX * 10) / 10)),
      y: Math.max(0, Math.min(spec.depth, Math.round(canvasY * 10) / 10)),
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.88;
    const newZoom = Math.max(0.5, Math.min(8.0, zoom * zoomFactor));
    setZoom(newZoom);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && isSpaceHeld)) {
      // Pan
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    const bedPt = getBedCoords(e.clientX, e.clientY);

    if (activeTool === 'select') {
      // Clicked empty background
      if (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'svg') {
        setIsPanning(true);
        setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        onSelectElement(null);
      }
    } else if (activeTool === 'text') {
      // Place text element
      const newTextElem: CanvasElement = {
        id: `text-${Date.now()}`,
        type: 'text',
        name: 'Vector Text',
        penId: pens[0]?.id || 'pen-black',
        x: bedPt.x,
        y: bedPt.y,
        width: 60,
        height: 20,
        rotation: 0,
        scale: 1,
        fillStyle: 'monotonic', // Default filled like 3D printing first-layer
        textContent: 'New Vector Text',
        fontFamily: 'Arial',
        fontSize: 10,
        isBold: true,
        isItalic: false,
        isUnderline: false,
        textAlign: 'left',
        lineHeight: 1.35,
        vectorPrecision: 7,
      };
      onAddElement(newTextElem);
      onSelectElement(newTextElem.id);
      onToolChange('select');
    } else {
      // Shape creation (rect, circle, line)
      setIsDrawingShape(true);
      setDrawStartBed(bedPt);
      setDrawCurrentBed(bedPt);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    } else if (isDrawingShape) {
      const bedPt = getBedCoords(e.clientX, e.clientY);
      setDrawCurrentBed(bedPt);
    } else if (draggingId) {
      const elem = elements.find((el) => el.id === draggingId);
      if (elem) {
        const bedPt = getBedCoords(e.clientX, e.clientY);
        const updatedX = Math.round((bedPt.x - dragOffset.x) * 10) / 10;
        const updatedY = Math.round((bedPt.y - dragOffset.y) * 10) / 10;

        onUpdateElement({
          ...elem,
          x: Math.max(0, Math.min(spec.width - elem.width, updatedX)),
          y: Math.max(0, Math.min(spec.depth - elem.height, updatedY)),
        });
      }
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }

    if (isDrawingShape) {
      setIsDrawingShape(false);
      const minX = Math.min(drawStartBed.x, drawCurrentBed.x);
      const maxX = Math.max(drawStartBed.x, drawCurrentBed.x);
      const minY = Math.min(drawStartBed.y, drawCurrentBed.y);
      const maxY = Math.max(drawStartBed.y, drawCurrentBed.y);
      const width = Math.max(6, Math.round((maxX - minX) * 10) / 10);
      const height = Math.max(6, Math.round((maxY - minY) * 10) / 10);

      const penId = pens[0]?.id || 'pen-black';

      let newElem: CanvasElement | null = null;

      if (activeTool === 'circle') {
        const radius = Math.max(4, Math.round(Math.max(width, height) / 2));
        newElem = {
          id: `circle-${Date.now()}`,
          type: 'circle',
          name: `Circle Ø${radius * 2}mm`,
          penId,
          x: minX,
          y: minY,
          width: radius * 2,
          height: radius * 2,
          radius,
          rotation: 0,
          scale: 1,
          fillStyle: 'outline',
        };
      } else if (activeTool === 'rect') {
        newElem = {
          id: `rect-${Date.now()}`,
          type: 'rect',
          name: `Rect ${width}×${height}mm`,
          penId,
          x: minX,
          y: minY,
          width,
          height,
          rotation: 0,
          scale: 1,
          fillStyle: 'outline',
        };
      } else if (activeTool === 'line') {
        newElem = {
          id: `line-${Date.now()}`,
          type: 'line',
          name: 'Vector Line',
          penId,
          x: minX,
          y: minY,
          width,
          height,
          points: [
            { x: 0, y: 0 },
            { x: width, y: height },
          ],
          rotation: 0,
          scale: 1,
          fillStyle: 'outline',
        };
      }

      if (newElem) {
        onAddElement(newElem);
        onSelectElement(newElem.id);
        onToolChange('select');
      }
    }

    setDraggingId(null);
  };

  const handleElementMouseDown = (e: React.MouseEvent, elem: CanvasElement) => {
    if (activeTool !== 'select') return;
    e.stopPropagation();
    onSelectElement(elem.id);
    setDraggingId(elem.id);

    const bedPt = getBedCoords(e.clientX, e.clientY);
    setDragOffset({
      x: bedPt.x - elem.x,
      y: bedPt.y - elem.y,
    });
  };

  const handleResetView = () => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const fitZoom = Math.min(
        (clientWidth - 100) / spec.width,
        (clientHeight - 100) / spec.depth,
        2.5
      );
      setZoom(fitZoom);
      setPan({
        x: (clientWidth - spec.width * fitZoom) / 2,
        y: (clientHeight - spec.depth * fitZoom) / 2,
      });
    }
  };

  const selectedElement = elements.find((el) => el.id === selectedElementId);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className={`relative flex-1 h-full bg-[#080a0f] overflow-hidden select-none ${
        activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'
      }`}
    >
      {/* Zoom / View HUD Toolbar */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 p-1.5 rounded-lg bg-[#121620]/90 border border-[#232c3d] backdrop-blur-md shadow-xl">
        <button
          onClick={() => setZoom((z) => Math.min(8.0, z * 1.2))}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-[#1f2738] transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.2))}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-[#1f2738] transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-[#232c3d]" />
        <button
          onClick={handleResetView}
          className="p-1.5 rounded-md text-slate-300 hover:text-white hover:bg-[#1f2738] transition-colors"
          title="Fit Bed to Screen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => setShowGrid((g) => !g)}
          className={`p-1.5 rounded-md transition-colors ${
            showGrid ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-white hover:bg-[#1f2738]'
          }`}
          title="Toggle Millimeter Grid"
        >
          <Grid className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-[#232c3d]" />
        <span className="text-[11px] font-mono text-slate-400 px-1">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Selected Element Quick Action floating bar */}
      {selectedElement && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121620]/95 border border-[#232c3d] shadow-xl text-xs">
          <span className="text-slate-300 font-medium truncate max-w-[140px]">
            {selectedElement.name}
          </span>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-cyan-400">
            X:{selectedElement.x.toFixed(1)} Y:{selectedElement.y.toFixed(1)}
          </span>
          <div className="w-px h-3.5 bg-[#232c3d] ml-1" />
          <button
            onClick={() => onDeleteElement(selectedElement.id)}
            className="p-1 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded transition-colors"
            title="Delete Element"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Coordinate Surface */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px)`,
          width: `${spec.width * zoom}px`,
          height: `${spec.depth * zoom}px`,
          position: 'absolute',
        }}
        className="transition-transform duration-75 ease-out shadow-2xl rounded-sm"
      >
        {/* PEI Textured Bed Surface - Crisp White for High Contrast */}
        <div
          style={{ width: '100%', height: '100%' }}
          className="relative bg-white border-4 border-[#333d4d] rounded-sm overflow-hidden shadow-2xl"
        >
          {/* Bed Slinger Axis Labels */}
          <div className="absolute top-1 inset-x-0 flex justify-center pointer-events-none z-10">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 bg-white/90 px-2 py-0.5 rounded shadow-xs border border-slate-200">
              Bed Slinger: Back of Bed (+Y)
            </span>
          </div>

          <div className="absolute bottom-1 inset-x-0 flex justify-center pointer-events-none z-10">
            <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 bg-white/90 px-2 py-0.5 rounded shadow-xs border border-slate-200">
              Bed Slinger: Front of Bed (Y=0, Toward User)
            </span>
          </div>

          {/* Millimeter Grid (High contrast on white surface) */}
          {showGrid && (
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              width="100%"
              height="100%"
            >
              <defs>
                <pattern
                  id="grid-10mm"
                  width={10 * zoom}
                  height={10 * zoom}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${10 * zoom} 0 L 0 0 0 ${10 * zoom}`}
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                </pattern>
                <pattern
                  id="grid-50mm"
                  width={50 * zoom}
                  height={50 * zoom}
                  patternUnits="userSpaceOnUse"
                >
                  <rect
                    width={50 * zoom}
                    height={50 * zoom}
                    fill="url(#grid-10mm)"
                  />
                  <path
                    d={`M ${50 * zoom} 0 L 0 0 0 ${50 * zoom}`}
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth="1.5"
                  />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#grid-50mm)" />
            </svg>
          )}

          {/* Rulers / Coordinate markers */}
          <div className="absolute bottom-1 left-2 text-[10px] font-mono font-bold text-slate-700 bg-white/80 px-1 rounded pointer-events-none z-10">
            (0, 0)
          </div>
          <div className="absolute bottom-1 right-2 text-[10px] font-mono font-bold text-slate-700 bg-white/80 px-1 rounded pointer-events-none z-10">
            ({spec.width}, 0)
          </div>
          <div className="absolute top-1 left-2 text-[10px] font-mono font-bold text-slate-700 bg-white/80 px-1 rounded pointer-events-none z-10">
            (0, {spec.depth})
          </div>
          <div className="absolute top-1 right-2 text-[10px] font-mono font-bold text-slate-700 bg-white/80 px-1 rounded pointer-events-none z-10">
            ({spec.width}, {spec.depth})
          </div>

          {/* Calibrated Paper Boundary with Painter's Tape styling */}
          {paperBounds.isCalibrated && (
            <div
              style={{
                left: `${paperBounds.bottomLeft.x * zoom}px`,
                bottom: `${paperBounds.bottomLeft.y * zoom}px`,
                width: `${paperBounds.widthMm * zoom}px`,
                height: `${paperBounds.heightMm * zoom}px`,
              }}
              className="absolute bg-[#fafbfe]/90 border-2 border-dashed border-cyan-600/90 rounded-xs shadow-sm pointer-events-none z-10"
            >
              {/* Corner Tape Visuals */}
              <div className="absolute -top-1.5 -left-1.5 w-7 h-3 bg-blue-500/80 rounded-xs transform -rotate-12 shadow-sm" />
              <div className="absolute -top-1.5 -right-1.5 w-7 h-3 bg-blue-500/80 rounded-xs transform rotate-12 shadow-sm" />
              <div className="absolute -bottom-1.5 -left-1.5 w-7 h-3 bg-blue-500/80 rounded-xs transform rotate-12 shadow-sm" />
              <div className="absolute -bottom-1.5 -right-1.5 w-7 h-3 bg-blue-500/80 rounded-xs transform -rotate-12 shadow-sm" />

              {/* Paper Dimension Marker */}
              <div className="absolute top-1 right-2 text-[9px] font-mono font-bold text-cyan-800 bg-cyan-50/90 px-1.5 py-0.5 rounded border border-cyan-200">
                Paper: {paperBounds.widthMm} × {paperBounds.heightMm} mm
              </div>
            </div>
          )}

          {/* Live Drawn Strokes Layer (Stamped from real/simulated plotting onto white bed) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-15">
            {drawnLines.map((line, idx) => (
              <line
                key={`line-${idx}`}
                x1={line.x1 * zoom}
                y1={(spec.depth - line.y1) * zoom}
                x2={line.x2 * zoom}
                y2={(spec.depth - line.y2) * zoom}
                stroke={line.colorHex}
                strokeWidth={Math.max(1.2, line.diameter * zoom)}
                strokeLinecap="round"
              />
            ))}
            {drawnDots.map((dot, idx) => (
              <circle
                key={`dot-${idx}`}
                cx={dot.x * zoom}
                cy={(spec.depth - dot.y) * zoom}
                r={Math.max(1.2, (dot.diameter * zoom) / 2)}
                fill={dot.colorHex}
              />
            ))}
          </svg>

          {/* Sliced Path Segments Preview (True continuous vector paths) */}
          {slicedJob && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-15">
              {slicedJob.layersByPen.map((layer) =>
                layer.strokeSegments.map((seg, sIdx) => {
                  if (seg.points.length < 2) return null;
                  const d = seg.points.reduce((acc, pt, i) => {
                    const canvasX = pt.x * zoom;
                    const canvasY = (spec.depth - pt.y) * zoom;
                    return `${acc} ${i === 0 ? 'M' : 'L'} ${canvasX} ${canvasY}`;
                  }, '');

                  return (
                    <path
                      key={`preview-${layer.pen.id}-${sIdx}`}
                      d={d}
                      fill="none"
                      stroke={layer.pen.hex}
                      strokeWidth={Math.max(1, layer.pen.diameter * zoom * 0.9)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })
              )}
            </svg>
          )}

          {/* Interactive Shape Creation Preview (While dragging to create rect/circle/line) */}
          {isDrawingShape && (
            <div
              style={{
                left: `${Math.min(drawStartBed.x, drawCurrentBed.x) * zoom}px`,
                bottom: `${Math.min(drawStartBed.y, drawCurrentBed.y) * zoom}px`,
                width: `${Math.abs(drawCurrentBed.x - drawStartBed.x) * zoom}px`,
                height: `${Math.abs(drawCurrentBed.y - drawStartBed.y) * zoom}px`,
                borderRadius: activeTool === 'circle' ? '9999px' : '0px',
              }}
              className="absolute border-2 border-emerald-500 bg-emerald-500/10 pointer-events-none z-30"
            >
              <div className="absolute -top-5 left-0 bg-emerald-600 text-white text-[9px] font-mono px-1 rounded shadow">
                {Math.round(Math.abs(drawCurrentBed.x - drawStartBed.x))} × {Math.round(Math.abs(drawCurrentBed.y - drawStartBed.y))} mm
              </div>
            </div>
          )}

          {/* Interactive Canvas Element Selection Bounding Boxes */}
          {elements.map((elem) => {
            const isSelected = elem.id === selectedElementId;

            return (
              <div
                key={elem.id}
                onMouseDown={(e) => handleElementMouseDown(e, elem)}
                style={{
                  left: `${elem.x * zoom}px`,
                  bottom: `${elem.y * zoom}px`,
                  width: `${elem.width * zoom}px`,
                  height: `${elem.height * zoom}px`,
                  transform: elem.rotation ? `rotate(${elem.rotation}deg)` : undefined,
                  borderRadius: elem.type === 'circle' ? '9999px' : '0px',
                }}
                className={`absolute cursor-move transition-shadow z-20 ${
                  isSelected
                    ? 'ring-2 ring-emerald-500 bg-emerald-500/5 shadow-md'
                    : 'hover:ring-1 hover:ring-slate-400'
                }`}
              >
                {/* Clean bounding tag */}
                {isSelected && (
                  <div className="absolute -top-5 left-0 bg-emerald-700 text-white text-[9px] font-mono px-1.5 py-0.5 rounded-t whitespace-nowrap shadow-xs">
                    {elem.name} ({elem.x.toFixed(1)}, {elem.y.toFixed(1)}mm)
                  </div>
                )}
              </div>
            );
          })}

          {/* DUAL CROSSHAIR HUD: HOTEND & REAL PEN TIP (accounting for X:0, Y:-29 offset) */}
          <div className="pointer-events-none">
            {/* Connecting offset line */}
            <svg className="absolute inset-0 w-full h-full">
              <line
                x1={hotendPos.x * zoom}
                y1={(spec.depth - hotendPos.y) * zoom}
                x2={penPos.x * zoom}
                y2={(spec.depth - penPos.y) * zoom}
                stroke="#06b6d4"
                strokeWidth="1.5"
                strokeDasharray="3 3"
                opacity="0.8"
              />
            </svg>

            {/* Hotend Toolhead Marker */}
            <div
              style={{
                left: `${hotendPos.x * zoom}px`,
                top: `${(spec.depth - hotendPos.y) * zoom}px`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
            >
              <div className="w-5 h-5 rounded-full border border-slate-300 bg-slate-800/80 flex items-center justify-center shadow-md">
                <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
              </div>
              <div className="absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap bg-black/85 text-[9px] font-mono text-slate-300 px-1 py-0.5 rounded border border-slate-700">
                Hotend: ({hotendPos.x.toFixed(1)}, {hotendPos.y.toFixed(1)})
              </div>
            </div>

            {/* Real Pen Tip Marker (Glowing Cyan Crosshair) */}
            <div
              style={{
                left: `${penPos.x * zoom}px`,
                top: `${(spec.depth - penPos.y) * zoom}px`,
              }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
            >
              <div className="relative">
                <div className="w-6 h-6 rounded-full border-2 border-cyan-400 bg-cyan-500/20 flex items-center justify-center shadow-lg shadow-cyan-500/40">
                  <div className="w-2 h-2 rounded-full bg-cyan-300" />
                </div>
                {/* Crosshair ticks */}
                <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0.5 h-1.5 bg-cyan-400" />
                <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0.5 h-1.5 bg-cyan-400" />
                <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-1.5 h-0.5 bg-cyan-400" />
                <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-1.5 h-0.5 bg-cyan-400" />
              </div>

              <div className="absolute top-7 left-1/2 -translate-x-1/2 whitespace-nowrap bg-cyan-950/90 text-[9px] font-mono text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/50 shadow">
                Pen: ({penPos.x.toFixed(1)}, {penPos.y.toFixed(1)}) · Z:{penPos.z.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom scale & legend indicator */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[#121620]/90 border border-[#232c3d] text-xs font-mono text-slate-400 backdrop-blur-md">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full border border-slate-300 bg-slate-700" />
          <span>Hotend Nozzle</span>
        </div>
        <span className="text-slate-600">·</span>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full border border-cyan-400 bg-cyan-500" />
          <span>
            Pen Tip (Offset X:{penOffset.x > 0 ? `+${penOffset.x}` : penOffset.x}mm, Y:{penOffset.y > 0 ? `+${penOffset.y}` : penOffset.y}mm)
          </span>
        </div>
        <span className="text-slate-600">·</span>
        <span className="text-emerald-400 font-semibold">
          Bed Slinger Mechanics (Y Bed + X Toolhead)
        </span>
      </div>
    </div>
  );
};
