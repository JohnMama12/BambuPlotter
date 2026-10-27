import { Point2D, PathSegment, InfillPattern } from '../types/plotter';

/**
 * Ramer-Douglas-Peucker polyline simplification.
 * Reduces dense subpixel points into clean, smooth vector paths with controlled tolerance.
 */
export function simplifyPoints(points: Point2D[], tolerance: number = 0.05): Point2D[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;
  const p1 = points[0];
  const p2 = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], p1, p2);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPoints(points.slice(0, index + 1), tolerance);
    const right = simplifyPoints(points.slice(index), tolerance);
    return left.slice(0, left.length - 1).concat(right);
  } else {
    return [p1, p2];
  }
}

function perpendicularDistance(p: Point2D, line1: Point2D, line2: Point2D): number {
  const dx = line2.x - line1.x;
  const dy = line2.y - line1.y;
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(p.x - line1.x, p.y - line1.y);
  return Math.abs(dy * p.x - dx * p.y + line2.x * line1.y - line2.y * line1.x) / mag;
}

/**
 * High-Precision Subpixel Marching Squares with Linear Interpolation.
 * Converts rasterized antialiased font glyphs and shapes into ultra-smooth,
 * continuous vector contours with zero pixel stair-stepping.
 *
 * @param data RGBA pixel buffer
 * @param width Canvas pixel width
 * @param height Canvas pixel height
 * @param scale Millimeters per pixel
 * @param vectorPrecision 1 (Low / draft) to 10 (Ultra / high resolution)
 */
export function traceContours(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
  vectorPrecision: number = 7
): Point2D[][] {
  const threshold = 120; // 50% luminance threshold for antialiased text boundary
  const tolerance = Math.max(0.015, (11 - Math.min(10, Math.max(1, vectorPrecision))) * 0.018);

  // Fast pixel value lookup
  const getVal = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0;
    const idx = (y * width + x) * 4;
    // Luminance formula
    return 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  };

  interface DirectedSegment {
    p1: Point2D;
    p2: Point2D;
  }

  const rawSegments: DirectedSegment[] = [];

  // Marching Squares across every 2x2 grid cell
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const v0 = getVal(x, y);         // Top-Left
      const v1 = getVal(x + 1, y);     // Top-Right
      const v2 = getVal(x + 1, y + 1); // Bottom-Right
      const v3 = getVal(x, y + 1);     // Bottom-Left

      const b0 = v0 >= threshold ? 1 : 0;
      const b1 = v1 >= threshold ? 2 : 0;
      const b2 = v2 >= threshold ? 4 : 0;
      const b3 = v3 >= threshold ? 8 : 0;
      const cell = b0 | b1 | b2 | b3;

      if (cell === 0 || cell === 15) continue; // All exterior or all interior

      // Subpixel linear interpolation on cell edges
      const interp = (valA: number, valB: number): number => {
        const denom = valB - valA;
        if (Math.abs(denom) < 1e-4) return 0.5;
        const t = (threshold - valA) / denom;
        return Math.max(0, Math.min(1, t));
      };

      // Midpoints with floating-point subpixel accuracy
      const topPt: Point2D = { x: x + interp(v0, v1), y: y };
      const rightPt: Point2D = { x: x + 1, y: y + interp(v1, v2) };
      const bottomPt: Point2D = { x: x + interp(v3, v2), y: y + 1 };
      const leftPt: Point2D = { x: x, y: y + interp(v0, v3) };

      switch (cell) {
        case 1:  // Top-Left only
          rawSegments.push({ p1: leftPt, p2: topPt });
          break;
        case 2:  // Top-Right only
          rawSegments.push({ p1: topPt, p2: rightPt });
          break;
        case 3:  // Top-Left & Top-Right
          rawSegments.push({ p1: leftPt, p2: rightPt });
          break;
        case 4:  // Bottom-Right only
          rawSegments.push({ p1: rightPt, p2: bottomPt });
          break;
        case 5:  // Saddle: Top-Left & Bottom-Right
          rawSegments.push({ p1: leftPt, p2: topPt });
          rawSegments.push({ p1: rightPt, p2: bottomPt });
          break;
        case 6:  // Top-Right & Bottom-Right
          rawSegments.push({ p1: topPt, p2: bottomPt });
          break;
        case 7:  // Not Bottom-Left
          rawSegments.push({ p1: leftPt, p2: bottomPt });
          break;
        case 8:  // Bottom-Left only
          rawSegments.push({ p1: bottomPt, p2: leftPt });
          break;
        case 9:  // Top-Left & Bottom-Left
          rawSegments.push({ p1: bottomPt, p2: topPt });
          break;
        case 10: // Saddle: Top-Right & Bottom-Left
          rawSegments.push({ p1: topPt, p2: rightPt });
          rawSegments.push({ p1: bottomPt, p2: leftPt });
          break;
        case 11: // Not Bottom-Right
          rawSegments.push({ p1: bottomPt, p2: rightPt });
          break;
        case 12: // Bottom-Left & Bottom-Right
          rawSegments.push({ p1: rightPt, p2: leftPt });
          break;
        case 13: // Not Top-Right
          rawSegments.push({ p1: rightPt, p2: topPt });
          break;
        case 14: // Not Top-Left
          rawSegments.push({ p1: topPt, p2: leftPt });
          break;
      }
    }
  }

  if (rawSegments.length === 0) return [];

  // Chain segments into closed polylines using spatial hash
  const keyPt = (p: Point2D) => `${Math.round(p.x * 200)},${Math.round(p.y * 200)}`;
  const startMap = new Map<string, number[]>();

  rawSegments.forEach((seg, idx) => {
    const k = keyPt(seg.p1);
    const arr = startMap.get(k) || [];
    arr.push(idx);
    startMap.set(k, arr);
  });

  const used = new Uint8Array(rawSegments.length);
  const loops: Point2D[][] = [];

  for (let i = 0; i < rawSegments.length; i++) {
    if (used[i]) continue;

    const currentLoop: Point2D[] = [rawSegments[i].p1, rawSegments[i].p2];
    used[i] = 1;
    let head = rawSegments[i].p2;
    let foundNext = true;
    let loopSteps = 0;
    const maxLoopSteps = rawSegments.length;

    while (foundNext && loopSteps < maxLoopSteps) {
      foundNext = false;
      loopSteps++;
      const k = keyPt(head);
      const candidates = startMap.get(k);

      if (candidates) {
        for (const cIdx of candidates) {
          if (!used[cIdx]) {
            used[cIdx] = 1;
            head = rawSegments[cIdx].p2;
            currentLoop.push(head);
            foundNext = true;
            break;
          }
        }
      }

      // Check if loop has closed back to start
      if (currentLoop.length > 3) {
        const dStart = Math.hypot(
          head.x - currentLoop[0].x,
          head.y - currentLoop[0].y
        );
        if (dStart < 0.25) {
          currentLoop[currentLoop.length - 1] = { ...currentLoop[0] };
          break;
        }
      }
    }

    if (currentLoop.length >= 4) {
      // Convert to millimeters and Cartesian Y (inverted so right-side up)
      const mmLoop: Point2D[] = currentLoop.map((pt) => ({
        x: pt.x * scale,
        y: (height - pt.y) * scale,
      }));

      // Simplify using Ramer-Douglas-Peucker with vector precision tolerance
      const simplified = simplifyPoints(mmLoop, tolerance);
      if (simplified.length >= 3) {
        loops.push(simplified);
      }
    }
  }

  return loops;
}

/**
 * First-Layer Infill Generator for arbitrary vector polygons & text contours.
 * Implements:
 * - Monotonic: unidirectional 45-degree sweeps from tip to tip with perimeter alignment
 * - Rectilinear: alternating 45-degree sweeps
 * - Grid: orthogonal cross-raster (45° + 135°)
 * - Concentric: nested inward offset perimeters
 */
export function generatePolygonInfill(
  contours: Point2D[][],
  penDiameter: number,
  pattern: InfillPattern,
  penId: string,
  angleDeg: number = 45
): PathSegment[] {
  if (pattern === 'outline' || contours.length === 0) {
    return [];
  }

  const result: PathSegment[] = [];
  const spacing = Math.max(0.3, penDiameter * 1.15);

  // Compute bounding box
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const loop of contours) {
    for (const pt of loop) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  if (maxX <= minX || maxY <= minY) return [];

  if (pattern === 'monotonic' || pattern === 'rectilinear' || pattern === 'grid') {
    const sweepLines = (angle: number, isAlternating: boolean): PathSegment[] => {
      const rad = (angle * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      // Normal to the lines: (-sinA, cosA)
      // Project bounding box corners onto normal to determine range
      const corners = [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ];

      const proj = corners.map((p) => -sinA * p.x + cosA * p.y);
      const minD = Math.min(...proj) - 0.1;
      const maxD = Math.max(...proj) + 0.1;

      const segments: PathSegment[] = [];
      let passCount = 0;

      for (let d = minD; d <= maxD; d += spacing) {
        passCount++;
        // Line equation: -sinA * x + cosA * y = d
        // Direction vector along line: (cosA, sinA)
        // Reference point: (-sinA * d, cosA * d)
        const refX = -sinA * d;
        const refY = cosA * d;

        // Find intersections with all polygon segments
        const intersections: number[] = [];

        for (const loop of contours) {
          for (let i = 0; i < loop.length - 1; i++) {
            const p1 = loop[i];
            const p2 = loop[i + 1];

            const d1 = -sinA * p1.x + cosA * p1.y - d;
            const d2 = -sinA * p2.x + cosA * p2.y - d;

            if ((d1 >= 0 && d2 < 0) || (d1 < 0 && d2 >= 0)) {
              const t = d1 / (d1 - d2);
              const ix = p1.x + t * (p2.x - p1.x);
              const iy = p1.y + t * (p2.y - p1.y);
              // Parameter 'u' along the line direction
              const u = (ix - refX) * cosA + (iy - refY) * sinA;
              intersections.push(u);
            }
          }
        }

        if (intersections.length < 2) continue;

        intersections.sort((a, b) => a - b);

        // Group pairs inside the polygon (even-odd rule)
        for (let j = 0; j < intersections.length - 1; j += 2) {
          const uA = intersections[j];
          const uB = intersections[j + 1];
          if (uB - uA < 0.1) continue; // skip tiny slivers

          const ptA: Point2D = {
            x: refX + uA * cosA,
            y: refY + uA * sinA,
          };
          const ptB: Point2D = {
            x: refX + uB * cosA,
            y: refY + uB * sinA,
          };

          if (isAlternating && passCount % 2 === 1) {
            segments.push({
              points: [ptB, ptA],
              penId,
            });
          } else {
            segments.push({
              points: [ptA, ptB],
              penId,
            });
          }
        }
      }

      return segments;
    };

    if (pattern === 'monotonic') {
      result.push(...sweepLines(angleDeg, false));
    } else if (pattern === 'rectilinear') {
      result.push(...sweepLines(angleDeg, true));
    } else if (pattern === 'grid') {
      result.push(...sweepLines(angleDeg, false));
      result.push(...sweepLines(angleDeg + 90, false));
    }
  } else if (pattern === 'concentric') {
    // Concentric inward offset loops
    const maxOffset = Math.min(maxX - minX, maxY - minY) * 0.45;
    for (let off = spacing; off < maxOffset; off += spacing) {
      for (const loop of contours) {
        if (loop.length < 4) continue;
        const insetLoop = offsetPolygonInward(loop, off);
        if (insetLoop && insetLoop.length >= 3) {
          result.push({
            points: insetLoop,
            penId,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Insets a simple closed polygon inward towards its center of mass.
 */
function offsetPolygonInward(loop: Point2D[], insetDistance: number): Point2D[] | null {
  let cx = 0;
  let cy = 0;
  const n = loop.length - 1;
  for (let i = 0; i < n; i++) {
    cx += loop[i].x;
    cy += loop[i].y;
  }
  cx /= n;
  cy /= n;

  const result: Point2D[] = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const dx = cx - p.x;
    const dy = cy - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= insetDistance) return null; // collapsed
    const factor = (dist - insetDistance) / dist;
    result.push({
      x: cx - dx * factor,
      y: cy - dy * factor,
    });
  }

  return result;
}
