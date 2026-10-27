export type PrinterModel = 'A1_MINI' | 'A1';

export interface PrinterDimensions {
  width: number; // mm (X)
  depth: number; // mm (Y)
  height: number; // mm (Z)
  name: string;
}

export const PRINTER_SPECS: Record<PrinterModel, PrinterDimensions> = {
  A1_MINI: {
    width: 180,
    depth: 180,
    height: 180,
    name: 'Bambu Lab A1 Mini (180 × 180 mm)',
  },
  A1: {
    width: 256,
    depth: 256,
    height: 256,
    name: 'Bambu Lab A1 (256 × 256 mm)',
  },
};

export interface Point2D {
  x: number;
  y: number;
}

export interface PaperBounds {
  isCalibrated: boolean;
  topLeft: Point2D;
  topRight: Point2D;
  bottomLeft: Point2D;
  bottomRight: Point2D;
  widthMm: number;
  heightMm: number;
  paperType?: string;
}

export interface PenOffset {
  x: number; // e.g. 0.0 mm
  y: number; // e.g. -29.0 mm (in front of hotend on bed slinger)
}

export type ZDatumSource = 'none' | 'bed_stop';

export interface ZCalibration {
  /**
   * Absolute machine Z captured when the toolhead has been jogged down to its
   * physical lower limit (the bed). This is the only Z value the operator
   * captures. Everything else is derived from it.
   */
  bedReferenceZ?: number;
  /**
   * Relative pen release / travel lift above the fixed drawing plane.
   * The drawing plane is always `bedReferenceZ + 1 mm`, so this is the only
   * adjustable Z value. Range 1–3 mm.
   */
  penReleaseMm?: number;
  isCalibrated: boolean;
  datumSource?: ZDatumSource;
  /** ISO timestamp of the bed-reference capture. */
  datumCapturedAt?: string | null;
}

export type QualityPreset = 'low' | 'medium' | 'normal' | 'high';

export interface QualitySettings {
  name: string;
  label: string;
  drawFeedrate: number; // mm/min
  travelFeedrate: number; // mm/min
  zLiftFeedrate: number; // mm/min
  acceleration: number; // mm/s^2
}

export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  low: {
    name: 'Low (Speedy)',
    label: 'Fastest plotting with 120mm/s feedrate',
    drawFeedrate: 7200, // 120 mm/s
    travelFeedrate: 10800, // 180 mm/s
    zLiftFeedrate: 3000,
    acceleration: 4000,
  },
  medium: {
    name: 'Medium (Faster)',
    label: 'Balanced 80mm/s speed for general illustrations',
    drawFeedrate: 4800, // 80 mm/s
    travelFeedrate: 8400, // 140 mm/s
    zLiftFeedrate: 2400,
    acceleration: 3000,
  },
  normal: {
    name: 'Normal (Standard)',
    label: 'Recommended 50mm/s for clean writing & solid lines',
    drawFeedrate: 3000, // 50 mm/s
    travelFeedrate: 6000, // 100 mm/s
    zLiftFeedrate: 1800,
    acceleration: 2000,
  },
  high: {
    name: 'High (Precision)',
    label: 'Highest precision 25mm/s for fine text & tight hatching',
    drawFeedrate: 1500, // 25 mm/s
    travelFeedrate: 3600, // 60 mm/s
    zLiftFeedrate: 1200,
    acceleration: 1200,
  },
};

export interface PenDefinition {
  id: string;
  name: string;
  hex: string;
  diameter: number; // mm (e.g. 0.7, 1.0)
  penType: 'gel' | 'ballpoint' | 'fineliner' | 'marker' | 'custom';
  isEnabled: boolean;
}

export const STANDARD_SOLID_PENS: PenDefinition[] = [
  { id: 'pen-black', name: 'Obsidian Black', hex: '#111827', diameter: 0.7, penType: 'gel', isEnabled: true },
  { id: 'pen-red', name: 'Crimson Red', hex: '#DC2626', diameter: 0.7, penType: 'gel', isEnabled: true },
  { id: 'pen-blue', name: 'Cobalt Blue', hex: '#2563EB', diameter: 1.0, penType: 'ballpoint', isEnabled: true },
  { id: 'pen-green', name: 'Forest Green', hex: '#16A34A', diameter: 0.7, penType: 'gel', isEnabled: true },
  { id: 'pen-yellow', name: 'Sunflower Yellow', hex: '#EAB308', diameter: 1.0, penType: 'ballpoint', isEnabled: true },
  { id: 'pen-orange', name: 'Tangerine Orange', hex: '#EA580C', diameter: 0.7, penType: 'fineliner', isEnabled: true },
  { id: 'pen-purple', name: 'Deep Violet', hex: '#9333EA', diameter: 0.7, penType: 'gel', isEnabled: true },
  { id: 'pen-cyan', name: 'Cyan Blue', hex: '#0891B2', diameter: 0.7, penType: 'fineliner', isEnabled: true },
  { id: 'pen-brown', name: 'Mocha Brown', hex: '#78350F', diameter: 1.0, penType: 'ballpoint', isEnabled: true },
  { id: 'pen-pink', name: 'Vivid Magenta', hex: '#DB2777', diameter: 0.7, penType: 'gel', isEnabled: true },
];

export type InfillPattern = 'outline' | 'monotonic' | 'concentric' | 'rectilinear' | 'grid';
export type FillStyle = InfillPattern; // Backwards-compatible alias

export type ElementType = 'text' | 'rect' | 'circle' | 'line' | 'svg';
export type ActiveTool = 'select' | 'text' | 'rect' | 'circle' | 'line';

export interface CanvasElement {
  id: string;
  type: ElementType;
  name: string;
  penId: string;
  x: number; // mm on bed
  y: number; // mm on bed
  width: number; // mm
  height: number; // mm
  rotation: number; // degrees
  scale: number;
  fillStyle: InfillPattern;
  infillDensity?: number; // 0 to 100% (defaults to 100% continuous)
  infillAngle?: number; // degrees (default 45)
  // Per-object Quality & Vector Precision
  qualityPreset?: QualityPreset;
  vectorPrecision?: number; // 1 (Low / Draft) to 10 (Ultra / High-Precision)
  // Text specific
  textContent?: string;
  fontFamily?: string;
  fontSize?: number; // mm
  isBold?: boolean;
  isItalic?: boolean;
  isUnderline?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  // Shape specific
  radius?: number; // for circle
  points?: Point2D[]; // for custom line
  // SVG specific
  svgString?: string;
  originalViewBox?: string;
}

export interface PathSegment {
  points: Point2D[];
  penId: string;
  isPeck?: boolean; // For stipple points
  qualityPreset?: QualityPreset;
  drawFeedrate?: number;
}

export interface SlicedPlotJob {
  id: string;
  totalLengthMm: number;
  totalTravelMm: number;
  estimatedSeconds: number;
  layersByPen: {
    pen: PenDefinition;
    strokeSegments: PathSegment[];
    totalPenLengthMm: number;
  }[];
}

export type MachineExecutionState =
  | 'idle'
  | 'homing'
  | 'leveling'
  | 'plotting'
  | 'paused'
  | 'waiting_pen_change'
  | 'completed'
  | 'aborted'
  | 'error';

export interface MachineTelemetry {
  isConnected: boolean;
  isSimulated: boolean;
  connectionMode: 'mqtt' | 'simulator';
  state: MachineExecutionState;
  hotendPos: { x: number; y: number; z: number };
  penPos: { x: number; y: number; z: number };
  currentPenIndex: number;
  currentPen: PenDefinition | null;
  currentStrokeIndex: number;
  totalStrokes: number;
  progressPercent: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  hotendTemp: number;
  bedTemp: number;
  fanSpeed: number;
  logMessages: string[];
  pendingColorChange?: {
    nextPen: PenDefinition;
    penIndex: number;
    totalPens: number;
  };
  connectionError?: string;
  connectedIp?: string;
  connectedSerial?: string;
}

export interface BambuConnectionConfig {
  ip: string;
  serialNumber: string;
  accessCode: string;
  port?: number;
  username?: string;
  protocol?: 'mqtts' | 'mqtt' | 'wss' | 'ws';
  isBridge?: boolean;
}
