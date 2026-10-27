import { Point2D, PathSegment, CanvasElement, InfillPattern, PenDefinition } from '../types/plotter';
import { traceContours, generatePolygonInfill } from './contourTracer';
import { parseSvgToSegments, optimizeTravelOrder } from './vectorEngine';

/**
 * High-Precision Vector & 3D Print First-Layer Slicer Engine.
 * Supports:
 * - Outline (perimeters only)
 * - Monotonic (unidirectional sweeping lines from tip to tip)
 * - Concentric (inward nested rings and offset loops)
 * - Rectilinear (alternating zigzag passes)
 * - Grid (orthogonal cross-hatch matrix)
 */
export function sliceElementToToolpaths(
  element: CanvasElement,
  pen: PenDefinition
): PathSegment[] {
  const segments: PathSegment[] = [];
  const diameter = Math.max(0.2, pen.diameter || 0.7);
  const pattern = element.fillStyle || 'outline';
  const precision = element.vectorPrecision || 7;

  if (element.type === 'circle') {
    const r = element.radius || Math.min(element.width, element.height) / 2;
    const cx = r;
    const cy = r;

    // 1. Perimeter Circle with dynamic vector precision steps (36 to 110 steps)
    const steps = Math.round(36 + precision * 8);
    const perimeter: Point2D[] = [];
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * Math.PI * 2;
      perimeter.push({
        x: cx + r * Math.cos(theta),
        y: cy + r * Math.sin(theta),
      });
    }
    segments.push({ points: perimeter, penId: element.penId, qualityPreset: element.qualityPreset });

    // 2. First-Layer Infill Patterns
    if (pattern === 'concentric') {
      // Concentric rings shrinking inward by pen diameter steps
      for (let curR = r - diameter; curR > diameter * 0.5; curR -= diameter) {
        const ring: Point2D[] = [];
        const ringSteps = Math.max(16, Math.round(steps * (curR / r)));
        for (let i = 0; i <= ringSteps; i++) {
          const theta = (i / ringSteps) * Math.PI * 2;
          ring.push({
            x: cx + curR * Math.cos(theta),
            y: cy + curR * Math.sin(theta),
          });
        }
        segments.push({ points: ring, penId: element.penId });
      }
      // Center dot
      segments.push({ points: [{ x: cx, y: cy }], penId: element.penId, isPeck: true });
    } else if (pattern === 'monotonic' || pattern === 'rectilinear') {
      // Monotonic 45-degree sweep across circle from tip to tip
      const sweepSegments = generateCircleMonotonicInfill(cx, cy, r - diameter * 0.5, diameter, element.penId);
      segments.push(...sweepSegments);
    } else if (pattern === 'grid') {
      // Orthogonal grid infill
      const sweep1 = generateCircleMonotonicInfill(cx, cy, r - diameter * 0.5, diameter * 1.5, element.penId, 45);
      const sweep2 = generateCircleMonotonicInfill(cx, cy, r - diameter * 0.5, diameter * 1.5, element.penId, 135);
      segments.push(...sweep1, ...sweep2);
    }
  } else if (element.type === 'rect') {
    const w = element.width;
    const h = element.height;

    // 1. Perimeter Rectangle
    segments.push({
      points: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
        { x: 0, y: 0 },
      ],
      penId: element.penId,
    });

    // 2. Infill Patterns
    if (pattern === 'concentric') {
      let curInset = diameter;
      while (w - curInset * 2 > diameter * 0.5 && h - curInset * 2 > diameter * 0.5) {
        segments.push({
          points: [
            { x: curInset, y: curInset },
            { x: w - curInset, y: curInset },
            { x: w - curInset, y: h - curInset },
            { x: curInset, y: h - curInset },
            { x: curInset, y: curInset },
          ],
          penId: element.penId,
        });
        curInset += diameter;
      }
    } else if (pattern === 'monotonic' || pattern === 'rectilinear') {
      const rectInfill = generateRectMonotonicInfill(w, h, diameter, element.penId);
      segments.push(...rectInfill);
    } else if (pattern === 'grid') {
      const g1 = generateRectMonotonicInfill(w, h, diameter * 1.8, element.penId, 45);
      const g2 = generateRectMonotonicInfill(w, h, diameter * 1.8, element.penId, 135);
      segments.push(...g1, ...g2);
    }
  } else if (element.type === 'line') {
    // Direct vector line or polyline
    const pts = element.points && element.points.length > 0
      ? element.points
      : [{ x: 0, y: 0 }, { x: element.width, y: element.height }];
    segments.push({ points: pts, penId: element.penId });
  } else if (element.type === 'text') {
    // High-fidelity vector text outlines using contour tracer
    const textSegments = sliceTextToVectorPaths(element, pen);
    segments.push(...textSegments);
  } else if (element.type === 'svg' && element.svgString) {
    const svgSegments = parseSvgToSegments(
      element.svgString,
      element.width,
      element.height,
      element.penId,
      element.fillStyle,
      pen.diameter
    );
    segments.push(...svgSegments);
  }

  return optimizeTravelOrder(segments);
}

/**
 * Slices text into true vector contours right-side up in Cartesian space.
 */
function sliceTextToVectorPaths(element: CanvasElement, pen: PenDefinition): PathSegment[] {
  const text = element.textContent || '';
  if (!text.trim()) return [];

  const fontSizeMm = element.fontSize || 12;
  const isBold = !!element.isBold;
  const isItalic = !!element.isItalic;
  const isUnderline = !!element.isUnderline;
  const align = element.textAlign || 'left';
  const lineHeight = element.lineHeight || 1.35;
  const fontFam = element.fontFamily || 'Arial';
  const precision = element.vectorPrecision || 7;
  const diameter = Math.max(0.2, pen.diameter || 0.7);

  // Subpixel sampling rate based on vector precision (6 to 12 px/mm)
  const dpr = Math.min(12, Math.max(6, Math.round(precision * 1.2)));
  const lines = text.split('\n');
  const linePx = fontSizeMm * dpr * lineHeight;
  const fontPx = Math.round(fontSizeMm * dpr);

  const canvas = document.createElement('canvas');
  const testCtx = canvas.getContext('2d');
  // System font fallback stack ensuring ANY system font is parsed properly
  const fontSpec = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : 'normal '}${fontPx}px "${fontFam}", sans-serif`;
  if (testCtx) testCtx.font = fontSpec;

  let maxLineWidth = 100;
  if (testCtx) {
    for (const l of lines) {
      const w = testCtx.measureText(l).width;
      if (w > maxLineWidth) maxLineWidth = w;
    }
  }

  const paddingPx = 20;
  canvas.width = Math.ceil(maxLineWidth + paddingPx * 2);
  canvas.height = Math.ceil(lines.length * linePx + paddingPx * 2);

  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = fontSpec;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';

  for (let l = 0; l < lines.length; l++) {
    const lineText = lines[l];
    const metrics = ctx.measureText(lineText);
    let startX = paddingPx;
    if (align === 'center') {
      startX = Math.max(paddingPx, (canvas.width - metrics.width) / 2);
    } else if (align === 'right') {
      startX = Math.max(paddingPx, canvas.width - metrics.width - paddingPx);
    }

    const currentY = paddingPx + l * linePx;
    ctx.fillText(lineText, startX, currentY);

    if (isUnderline) {
      const underlineY = currentY + fontPx * 1.05;
      const underlineH = Math.max(2, Math.round(fontPx * 0.08));
      ctx.fillRect(startX, underlineY, metrics.width, underlineH);
    }
  }

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mmPerPx = 1 / dpr;

  // Extract smooth subpixel vector contours
  const contours = traceContours(imgData.data, canvas.width, canvas.height, mmPerPx, precision);

  // 1. Boundary Perimeter Toolpaths
  const outlineSegments: PathSegment[] = contours.map((pts) => ({
    points: pts,
    penId: element.penId,
    qualityPreset: element.qualityPreset,
  }));

  // 2. Real-time Infill Toolpaths (Monotonic by default!)
  const infillPattern = element.fillStyle || 'monotonic';
  const infillSegments: PathSegment[] = generatePolygonInfill(
    contours,
    diameter,
    infillPattern,
    element.penId,
    element.infillAngle || 45
  ).map((seg) => ({
    ...seg,
    qualityPreset: element.qualityPreset,
  }));

  return [...outlineSegments, ...infillSegments];
}

/**
 * 3D Print First-Layer Monotonic Infill across Circle.
 * Sweeps lines monotonically from tip to tip inside circle radius.
 */
function generateCircleMonotonicInfill(
  cx: number,
  cy: number,
  radius: number,
  spacing: number,
  penId: string,
  angleDeg: number = 45
): PathSegment[] {
  const segments: PathSegment[] = [];
  const numLines = Math.floor((radius * 2) / spacing);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  for (let i = 1; i < numLines; i++) {
    const offset = -radius + i * spacing;
    // Half chord length at distance offset from center
    const chordSq = radius * radius - offset * offset;
    if (chordSq > 0) {
      const halfChord = Math.sqrt(chordSq);
      // Local line points: (-halfChord, offset) to (+halfChord, offset)
      const p1x = cx + (-halfChord * -sin + offset * cos);
      const p1y = cy + (-halfChord * cos + offset * sin);
      const p2x = cx + (halfChord * -sin + offset * cos);
      const p2y = cy + (halfChord * cos + offset * sin);

      segments.push({
        points: [{ x: p1x, y: p1y }, { x: p2x, y: p2y }],
        penId,
      });
    }
  }

  return segments;
}

/**
 * 3D Print First-Layer Monotonic Infill across Rectangle.
 */
function generateRectMonotonicInfill(
  w: number,
  h: number,
  spacing: number,
  penId: string,
  angleDeg: number = 45
): PathSegment[] {
  const segments: PathSegment[] = [];
  const diag = Math.hypot(w, h);
  const numLines = Math.ceil(diag / spacing);

  for (let i = -numLines; i <= numLines; i++) {
    const offset = i * spacing;
    // 45 degree line: y - x = offset
    const x1 = 0;
    const y1 = offset;
    const x2 = w;
    const y2 = w + offset;

    const clipped = clipLineToBox(x1, y1, x2, y2, 0, 0, w, h);
    if (clipped) {
      segments.push({
        points: [clipped.p1, clipped.p2],
        penId,
      });
    }
  }

  return segments;
}

function clipLineToBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { p1: Point2D; p2: Point2D } | null {
  const INSIDE = 0;
  const LEFT = 1;
  const RIGHT = 2;
  const BOTTOM = 4;
  const TOP = 8;

  function code(x: number, y: number): number {
    let c = INSIDE;
    if (x < minX) c |= LEFT;
    else if (x > maxX) c |= RIGHT;
    if (y < minY) c |= BOTTOM;
    else if (y > maxY) c |= TOP;
    return c;
  }

  let c1 = code(x1, y1);
  let c2 = code(x2, y2);

  while (true) {
    if ((c1 | c2) === 0) return { p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
    if (c1 & c2) return null;

    let x = 0;
    let y = 0;
    const cOut = c1 !== 0 ? c1 : c2;

    if (cOut & TOP) {
      x = x1 + ((x2 - x1) * (maxY - y1)) / (y2 - y1);
      y = maxY;
    } else if (cOut & BOTTOM) {
      x = x1 + ((x2 - x1) * (minY - y1)) / (y2 - y1);
      y = minY;
    } else if (cOut & RIGHT) {
      y = y1 + ((y2 - y1) * (maxX - x1)) / (x2 - x1);
      x = maxX;
    } else if (cOut & LEFT) {
      y = y1 + ((y2 - y1) * (minX - x1)) / (x2 - x1);
      x = minX;
    }

    if (cOut === c1) {
      x1 = x;
      y1 = y;
      c1 = code(x1, y1);
    } else {
      x2 = x;
      y2 = y;
      c2 = code(x2, y2);
    }
  }
}
