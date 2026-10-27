import { Point2D, PathSegment, CanvasElement, FillStyle, PenDefinition } from '../types/plotter';
import { traceContours } from './contourTracer';
import { generateVectorTextPaths } from './vectorFont';

/**
 * Parses SVG XML or snippets and extracts vector path segments normalized to millimeters.
 */
export function parseSvgToSegments(
  svgString: string,
  targetWidthMm: number,
  targetHeightMm: number,
  penId: string,
  fillStyle: FillStyle = 'outline',
  penDiameter: number = 0.7
): PathSegment[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return [];

  // Determine viewBox or dimensions
  let vbWidth = 100;
  let vbHeight = 100;
  const viewBoxAttr = svgEl.getAttribute('viewBox');
  if (viewBoxAttr) {
    const parts = viewBoxAttr.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      vbWidth = parts[2];
      vbHeight = parts[3];
    }
  } else {
    vbWidth = parseFloat(svgEl.getAttribute('width') || '100') || 100;
    vbHeight = parseFloat(svgEl.getAttribute('height') || '100') || 100;
  }

  const scaleX = targetWidthMm / vbWidth;
  const scaleY = targetHeightMm / vbHeight;

  const rawSegments: Point2D[][] = [];

  // Extract from <path> elements
  const paths = doc.querySelectorAll('path');
  paths.forEach((p) => {
    const d = p.getAttribute('d');
    if (d) {
      const segs = parseSvgPathD(d, scaleX, scaleY);
      rawSegments.push(...segs);
    }
  });

  // Extract from <polyline> and <polygon>
  const polylines = doc.querySelectorAll('polyline, polygon');
  polylines.forEach((pl) => {
    const ptsAttr = pl.getAttribute('points');
    if (ptsAttr) {
      const coords = ptsAttr.trim().split(/[\s,]+/).map(Number);
      const points: Point2D[] = [];
      for (let i = 0; i < coords.length - 1; i += 2) {
        if (!isNaN(coords[i]) && !isNaN(coords[i + 1])) {
          points.push({ x: coords[i] * scaleX, y: coords[i + 1] * scaleY });
        }
      }
      if (pl.tagName.toLowerCase() === 'polygon' && points.length > 2) {
        points.push({ ...points[0] });
      }
      if (points.length > 1) {
        rawSegments.push(points);
      }
    }
  });

  // Extract from <line>
  const lines = doc.querySelectorAll('line');
  lines.forEach((l) => {
    const x1 = (parseFloat(l.getAttribute('x1') || '0') || 0) * scaleX;
    const y1 = (parseFloat(l.getAttribute('y1') || '0') || 0) * scaleY;
    const x2 = (parseFloat(l.getAttribute('x2') || '0') || 0) * scaleX;
    const y2 = (parseFloat(l.getAttribute('y2') || '0') || 0) * scaleY;
    rawSegments.push([{ x: x1, y: y1 }, { x: x2, y: y2 }]);
  });

  // Extract from <rect>
  const rects = doc.querySelectorAll('rect');
  rects.forEach((r) => {
    const x = (parseFloat(r.getAttribute('x') || '0') || 0) * scaleX;
    const y = (parseFloat(r.getAttribute('y') || '0') || 0) * scaleY;
    const w = (parseFloat(r.getAttribute('width') || '0') || 0) * scaleX;
    const h = (parseFloat(r.getAttribute('height') || '0') || 0) * scaleY;
    if (w > 0 && h > 0) {
      rawSegments.push([
        { x, y },
        { x: x + w, y },
        { x: x + w, y: y + h },
        { x, y: y + h },
        { x, y },
      ]);
    }
  });

  // Extract from <circle> and <ellipse>
  const circles = doc.querySelectorAll('circle, ellipse');
  circles.forEach((c) => {
    const cx = (parseFloat(c.getAttribute('cx') || '0') || 0) * scaleX;
    const cy = (parseFloat(c.getAttribute('cy') || '0') || 0) * scaleY;
    const rx = (parseFloat(c.getAttribute('rx') || c.getAttribute('r') || '0') || 0) * scaleX;
    const ry = (parseFloat(c.getAttribute('ry') || c.getAttribute('r') || '0') || 0) * scaleY;
    if (rx > 0 && ry > 0) {
      const steps = 36;
      const pts: Point2D[] = [];
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        pts.push({
          x: cx + rx * Math.cos(theta),
          y: cy + ry * Math.sin(theta),
        });
      }
      rawSegments.push(pts);
    }
  });

  // Apply stylized fill if requested
  const outputSegments: PathSegment[] = [];

  // Outlines are always included
  for (const seg of rawSegments) {
    if (seg.length > 1) {
      outputSegments.push({ points: seg, penId });
    }
  }

  if (fillStyle && fillStyle !== 'outline') {
    const fillInfill = generateInfill(rawSegments, targetWidthMm, targetHeightMm, fillStyle, penDiameter, penId);
    outputSegments.push(...fillInfill);
  }

  return optimizeTravelOrder(outputSegments);
}

/**
 * Basic SVG Path 'd' parser that turns bezier curves and lines into discretized polylines.
 */
function parseSvgPathD(d: string, scaleX: number, scaleY: number): Point2D[][] {
  const segments: Point2D[][] = [];
  let currentPoints: Point2D[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  // Split d string into tokens
  const tokens = d.match(/([a-df-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi) || [];
  let i = 0;
  let currentCmd = '';

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[a-df-z]$/i.test(token)) {
      currentCmd = token;
      i++;
    }

    if (!currentCmd) {
      i++;
      continue;
    }

    const isRelative = currentCmd === currentCmd.toLowerCase();
    const cmdUpper = currentCmd.toUpperCase();

    if (cmdUpper === 'M') {
      const nx = parseFloat(tokens[i++]);
      const ny = parseFloat(tokens[i++]);
      curX = isRelative ? curX + nx : nx;
      curY = isRelative ? curY + ny : ny;
      startX = curX;
      startY = curY;

      if (currentPoints.length > 1) {
        segments.push(currentPoints);
      }
      currentPoints = [{ x: curX * scaleX, y: curY * scaleY }];
      currentCmd = isRelative ? 'l' : 'L'; // Subsequent coordinates are line-tos
    } else if (cmdUpper === 'L') {
      const nx = parseFloat(tokens[i++]);
      const ny = parseFloat(tokens[i++]);
      curX = isRelative ? curX + nx : nx;
      curY = isRelative ? curY + ny : ny;
      currentPoints.push({ x: curX * scaleX, y: curY * scaleY });
    } else if (cmdUpper === 'H') {
      const nx = parseFloat(tokens[i++]);
      curX = isRelative ? curX + nx : nx;
      currentPoints.push({ x: curX * scaleX, y: curY * scaleY });
    } else if (cmdUpper === 'V') {
      const ny = parseFloat(tokens[i++]);
      curY = isRelative ? curY + ny : ny;
      currentPoints.push({ x: curX * scaleX, y: curY * scaleY });
    } else if (cmdUpper === 'C') {
      const x1 = parseFloat(tokens[i++]);
      const y1 = parseFloat(tokens[i++]);
      const x2 = parseFloat(tokens[i++]);
      const y2 = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);

      const cp1x = isRelative ? curX + x1 : x1;
      const cp1y = isRelative ? curY + y1 : y1;
      const cp2x = isRelative ? curX + x2 : x2;
      const cp2y = isRelative ? curY + y2 : y2;
      const endX = isRelative ? curX + x : x;
      const endY = isRelative ? curY + y : y;

      // Discretize cubic bezier
      const steps = 12;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const it = 1 - t;
        const bx = it * it * it * curX + 3 * it * it * t * cp1x + 3 * it * t * t * cp2x + t * t * t * endX;
        const by = it * it * it * curY + 3 * it * it * t * cp1y + 3 * it * t * t * cp2y + t * t * t * endY;
        currentPoints.push({ x: bx * scaleX, y: by * scaleY });
      }

      curX = endX;
      curY = endY;
    } else if (cmdUpper === 'S') {
      const x2 = parseFloat(tokens[i++]);
      const y2 = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);

      const cp2x = isRelative ? curX + x2 : x2;
      const cp2y = isRelative ? curY + y2 : y2;
      const endX = isRelative ? curX + x : x;
      const endY = isRelative ? curY + y : y;
      const cp1x = curX;
      const cp1y = curY;

      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const it = 1 - t;
        const bx = it * it * it * curX + 3 * it * it * t * cp1x + 3 * it * t * t * cp2x + t * t * t * endX;
        const by = it * it * it * curY + 3 * it * it * t * cp1y + 3 * it * t * t * cp2y + t * t * t * endY;
        currentPoints.push({ x: bx * scaleX, y: by * scaleY });
      }

      curX = endX;
      curY = endY;
    } else if (cmdUpper === 'Q') {
      const x1 = parseFloat(tokens[i++]);
      const y1 = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);

      const cpx = isRelative ? curX + x1 : x1;
      const cpy = isRelative ? curY + y1 : y1;
      const endX = isRelative ? curX + x : x;
      const endY = isRelative ? curY + y : y;

      const steps = 10;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const it = 1 - t;
        const qx = it * it * curX + 2 * it * t * cpx + t * t * endX;
        const qy = it * it * curY + 2 * it * t * cpy + t * t * endY;
        currentPoints.push({ x: qx * scaleX, y: qy * scaleY });
      }

      curX = endX;
      curY = endY;
    } else if (cmdUpper === 'Z') {
      curX = startX;
      curY = startY;
      currentPoints.push({ x: curX * scaleX, y: curY * scaleY });
      if (currentPoints.length > 1) {
        segments.push(currentPoints);
      }
      currentPoints = [];
    } else {
      // Unhandled or skip token
      i++;
    }
  }

  if (currentPoints.length > 1) {
    segments.push(currentPoints);
  }

  return segments;
}

/**
 * Generate paragraph text vector strokes with true continuous vector loops,
 * curves, and formatting (bold, italic, underline, alignment).
 * 100% vectorized outlines right-side up without dot-matrix scanlines.
 */
export function generateTextStrokes(
  element: CanvasElement,
  pen: PenDefinition
): PathSegment[] {
  const text = element.textContent || '';
  if (!text.trim()) return [];

  const fontSizeMm = element.fontSize || 12; // mm
  const isBold = !!element.isBold;
  const isItalic = !!element.isItalic;
  const isUnderline = !!element.isUnderline;
  const align = element.textAlign || 'left';
  const lineHeight = element.lineHeight || 1.35;
  const fontFam = element.fontFamily || 'Plus Jakarta Sans';

  // High-res offscreen canvas for vector contour tracing
  const dpr = 5; // 5 pixels per millimeter for fine curve fidelity
  const lines = text.split('\n');
  const linePx = fontSizeMm * dpr * lineHeight;
  const fontPx = Math.round(fontSizeMm * dpr);

  const canvas = document.createElement('canvas');
  const testCtx = canvas.getContext('2d');
  const fontSpec = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : 'normal '}${fontPx}px "${fontFam}", sans-serif`;
  if (testCtx) testCtx.font = fontSpec;

  let maxLineWidth = 100;
  if (testCtx) {
    for (const l of lines) {
      const w = testCtx.measureText(l).width;
      if (w > maxLineWidth) maxLineWidth = w;
    }
  }

  const paddingPx = 16;
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

  // Trace true continuous vector contours!
  const contours = traceContours(imgData.data, canvas.width, canvas.height, mmPerPx);

  const segments: PathSegment[] = contours.map((pts) => ({
    points: pts,
    penId: element.penId,
  }));

  return optimizeTravelOrder(segments);
}

/**
 * Infill generator for cross-hatch, diagonal hatch, and stipple dot pecking.
 */
function generateInfill(
  boundaryPolys: Point2D[][],
  widthMm: number,
  heightMm: number,
  style: FillStyle,
  penDiameter: number,
  penId: string
): PathSegment[] {
  const result: PathSegment[] = [];
  const spacing = Math.max(0.4, penDiameter * 1.4);

  if (style === 'monotonic' || style === 'rectilinear') {
    // 45 degree raster sweeping from bottom-left to top-right like 3D printing first-layer
    const diag = Math.sqrt(widthMm * widthMm + heightMm * heightMm);
    const numLines = Math.ceil(diag / spacing);

    for (let i = -numLines; i <= numLines; i++) {
      const offset = i * spacing;
      // Line: y - x = offset
      const x1 = 0;
      const y1 = offset;
      const x2 = widthMm;
      const y2 = widthMm + offset;

      const clipped = clipLineToBounds(x1, y1, x2, y2, 0, 0, widthMm, heightMm);
      if (clipped) {
        // Monotonic keeps direction consistent; rectilinear alternates
        if (style === 'rectilinear' && Math.abs(i) % 2 === 1) {
          result.push({
            points: [clipped.p2, clipped.p1],
            penId,
          });
        } else {
          result.push({
            points: [clipped.p1, clipped.p2],
            penId,
          });
        }
      }
    }
  } else if (style === 'grid') {
    // 45 degree + 135 degree orthogonal grid
    const diag = Math.sqrt(widthMm * widthMm + heightMm * heightMm);
    const numLines = Math.ceil(diag / spacing);

    for (let i = -numLines; i <= numLines; i++) {
      const offset = i * spacing;
      const x1 = 0;
      const y1 = offset;
      const x2 = widthMm;
      const y2 = widthMm + offset;

      const clipped = clipLineToBounds(x1, y1, x2, y2, 0, 0, widthMm, heightMm);
      if (clipped) {
        result.push({
          points: [clipped.p1, clipped.p2],
          penId,
        });
      }
    }

    for (let i = 0; i <= numLines * 2; i++) {
      const offset = i * spacing;
      const x1 = 0;
      const y1 = offset;
      const x2 = widthMm;
      const y2 = offset - widthMm;

      const clipped = clipLineToBounds(x1, y1, x2, y2, 0, 0, widthMm, heightMm);
      if (clipped) {
        result.push({
          points: [clipped.p1, clipped.p2],
          penId,
        });
      }
    }
  } else if (style === 'concentric') {
    // Nested concentric shrinking bounding boxes
    const maxInward = Math.min(widthMm, heightMm) / 2;
    for (let inset = spacing; inset < maxInward; inset += spacing) {
      const xL = inset;
      const xR = widthMm - inset;
      const yB = inset;
      const yT = heightMm - inset;
      if (xR > xL && yT > yB) {
        result.push({
          points: [
            { x: xL, y: yB },
            { x: xR, y: yB },
            { x: xR, y: yT },
            { x: xL, y: yT },
            { x: xL, y: yB },
          ],
          penId,
        });
      }
    }
  }

  return result;
}

function clipLineToBounds(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): { p1: Point2D; p2: Point2D } | null {
  // Cohen-Sutherland line clipping
  const INSIDE = 0;
  const LEFT = 1;
  const RIGHT = 2;
  const BOTTOM = 4;
  const TOP = 8;

  function computeOutCode(x: number, y: number): number {
    let code = INSIDE;
    if (x < minX) code |= LEFT;
    else if (x > maxX) code |= RIGHT;
    if (y < minY) code |= BOTTOM;
    else if (y > maxY) code |= TOP;
    return code;
  }

  let code1 = computeOutCode(x1, y1);
  let code2 = computeOutCode(x2, y2);
  let accept = false;

  while (true) {
    if ((code1 | code2) === 0) {
      accept = true;
      break;
    } else if (code1 & code2) {
      break;
    } else {
      let x = 0;
      let y = 0;
      const codeOut = code1 !== 0 ? code1 : code2;

      if (codeOut & TOP) {
        x = x1 + ((x2 - x1) * (maxY - y1)) / (y2 - y1);
        y = maxY;
      } else if (codeOut & BOTTOM) {
        x = x1 + ((x2 - x1) * (minY - y1)) / (y2 - y1);
        y = minY;
      } else if (codeOut & RIGHT) {
        y = y1 + ((y2 - y1) * (maxX - x1)) / (x2 - x1);
        x = maxX;
      } else if (codeOut & LEFT) {
        y = y1 + ((y2 - y1) * (minX - x1)) / (x2 - x1);
        x = minX;
      }

      if (codeOut === code1) {
        x1 = x;
        y1 = y;
        code1 = computeOutCode(x1, y1);
      } else {
        x2 = x;
        y2 = y;
        code2 = computeOutCode(x2, y2);
      }
    }
  }

  if (accept) {
    return { p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } };
  }
  return null;
}

/**
 * Greedy Traveling Salesperson path optimizer: reorders stroke segments
 * to minimize rapid air travel distance between strokes.
 */
export function optimizeTravelOrder(segments: PathSegment[]): PathSegment[] {
  if (segments.length <= 2) return segments;

  const remaining = [...segments];
  const ordered: PathSegment[] = [];

  let currentHead = { x: 0, y: 0 };

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    let shouldReverse = false;

    for (let i = 0; i < remaining.length; i++) {
      const seg = remaining[i];
      if (seg.points.length === 0) continue;

      const startPt = seg.points[0];
      const endPt = seg.points[seg.points.length - 1];

      const distStart = Math.hypot(startPt.x - currentHead.x, startPt.y - currentHead.y);
      const distEnd = Math.hypot(endPt.x - currentHead.x, endPt.y - currentHead.y);

      if (distStart < nearestDist) {
        nearestDist = distStart;
        nearestIdx = i;
        shouldReverse = false;
      }
      if (distEnd < nearestDist && !seg.isPeck) {
        nearestDist = distEnd;
        nearestIdx = i;
        shouldReverse = true;
      }
    }

    const [chosen] = remaining.splice(nearestIdx, 1);
    if (shouldReverse) {
      chosen.points.reverse();
    }
    ordered.push(chosen);
    currentHead = chosen.points[chosen.points.length - 1];
  }

  return ordered;
}
