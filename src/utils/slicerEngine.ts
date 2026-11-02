import { Point2D, PathSegment, CanvasElement, InfillPattern, PenDefinition } from '../types/plotter';
import { traceContours, generatePolygonInfill } from './contourTracer';
import { parseSvgToSegments, optimizeTravelOrder } from './vectorEngine';
import { generateVectorTextPaths } from './vectorFont';

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
  const hatchAngle = element.hatchAngle !== undefined ? element.hatchAngle : (element.infillAngle ?? 45);
  const hatchSpacing = element.hatchSpacingMm !== undefined && element.hatchSpacingMm > 0
    ? Math.max(0.2, element.hatchSpacingMm)
    : Math.max(0.3, diameter * 1.2);

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

    // 2. Vector Infill / Hatch Patterns
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
    } else if (pattern === 'parallel_hatch' || pattern === 'monotonic' || pattern === 'rectilinear') {
      const sweepSegments = generateCircleHatchInfill(cx, cy, r - diameter * 0.5, hatchSpacing, element.penId, hatchAngle);
      segments.push(...sweepSegments);
    } else if (pattern === 'crosshatch' || pattern === 'grid') {
      const sweep1 = generateCircleHatchInfill(cx, cy, r - diameter * 0.5, hatchSpacing, element.penId, hatchAngle);
      const sweep2 = generateCircleHatchInfill(cx, cy, r - diameter * 0.5, hatchSpacing, element.penId, hatchAngle + 90);
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

    // 2. Vector Infill / Hatch Patterns
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
    } else if (pattern === 'parallel_hatch' || pattern === 'monotonic' || pattern === 'rectilinear') {
      const rectInfill = generateRectHatchInfill(w, h, hatchSpacing, element.penId, hatchAngle);
      segments.push(...rectInfill);
    } else if (pattern === 'crosshatch' || pattern === 'grid') {
      const g1 = generateRectHatchInfill(w, h, hatchSpacing, element.penId, hatchAngle);
      const g2 = generateRectHatchInfill(w, h, hatchSpacing, element.penId, hatchAngle + 90);
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
  const diameter = Math.max(0.2, pen.diameter || 0.7);

  const rawSegments = generateVectorTextPaths(text, fontSizeMm, element.penId, {
    isBold,
    isItalic,
    isUnderline,
    textAlign: align,
    lineHeight,
    penDiameter: diameter,
  });

  const lines = text.split('\n');
  const lineSpacing = fontSizeMm * lineHeight;
  const totalH = Math.max(element.height || 0, lines.length * lineSpacing);

  // In vectorFont: curY starts at 0 (top line) and goes down.
  // In Bed Cartesian coordinates, Y=0 is bottom and increases upward.
  // We flip Y so line 1 is rendered at the top of the element box.
  return rawSegments.map((seg) => ({
    ...seg,
    qualityPreset: element.qualityPreset,
    points: seg.points.map((pt) => ({
      x: Math.round(pt.x * 100) / 100,
      y: Math.round((totalH - pt.y - fontSizeMm * 0.9) * 100) / 100,
    })),
  }));
}

/**
 * Universal Vector Hatch Infill across Circle at any angle (0 to 180 deg).
 */
function generateCircleHatchInfill(
  cx: number,
  cy: number,
  radius: number,
  spacing: number,
  penId: string,
  angleDeg: number = 45
): PathSegment[] {
  const segments: PathSegment[] = [];
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const numLines = Math.floor((radius * 2) / spacing);
  for (let i = 1; i < numLines; i++) {
    const offset = -radius + i * spacing;
    const chordSq = radius * radius - offset * offset;
    if (chordSq > 0) {
      const halfChord = Math.sqrt(chordSq);
      // Along line: (cos, sin), normal: (-sin, cos)
      const p1x = cx - offset * sin - halfChord * cos;
      const p1y = cy + offset * cos - halfChord * sin;
      const p2x = cx - offset * sin + halfChord * cos;
      const p2y = cy + offset * cos + halfChord * sin;

      segments.push({
        points: [{ x: p1x, y: p1y }, { x: p2x, y: p2y }],
        penId,
      });
    }
  }

  return segments;
}

/**
 * Universal Vector Hatch Infill across Rectangle at any angle (0 to 180 deg).
 */
function generateRectHatchInfill(
  w: number,
  h: number,
  spacing: number,
  penId: string,
  angleDeg: number = 45
): PathSegment[] {
  const segments: PathSegment[] = [];
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.hypot(w, h) / 2;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const numLines = Math.ceil((radius * 2) / spacing);
  for (let i = -numLines; i <= numLines; i++) {
    const offset = i * spacing;
    const p1x = cx - offset * sin - radius * cos;
    const p1y = cy + offset * cos - radius * sin;
    const p2x = cx - offset * sin + radius * cos;
    const p2y = cy + offset * cos + radius * sin;

    const clipped = clipLineToBox(p1x, p1y, p2x, p2y, 0, 0, w, h);
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
