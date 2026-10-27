import { Point2D, PathSegment } from '../types/plotter';

/**
 * Normalized 2D vector glyph definitions (0 to 1 range in X and Y).
 * Each glyph is represented as an array of continuous polylines (stroke paths).
 * Circular characters (O, 0, C, B, D, P, R, etc.) are defined with smooth continuous arcs/loops.
 */
type GlyphStrokes = Point2D[][];

// Helper to create circle/arc points
function makeArc(cx: number, cy: number, rx: number, ry: number, startAngle: number, endAngle: number, steps = 14): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = startAngle + (endAngle - startAngle) * (i / steps);
    pts.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }
  return pts;
}

const GLYPHS: Record<string, GlyphStrokes> = {
  // Uppercase
  'A': [
    [{ x: 0, y: 1 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }],
    [{ x: 0.22, y: 0.62 }, { x: 0.78, y: 0.62 }],
  ],
  'B': [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    makeArc(0.4, 0.25, 0.35, 0.25, -Math.PI / 2, Math.PI / 2),
    makeArc(0.42, 0.75, 0.38, 0.25, -Math.PI / 2, Math.PI / 2),
    [{ x: 0.1, y: 0 }, { x: 0.4, y: 0 }],
    [{ x: 0.1, y: 0.5 }, { x: 0.42, y: 0.5 }],
    [{ x: 0.1, y: 1 }, { x: 0.42, y: 1 }],
  ],
  'C': [
    makeArc(0.55, 0.5, 0.42, 0.48, Math.PI * 0.25, Math.PI * 1.75),
  ],
  'D': [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    [{ x: 0.1, y: 0 }, { x: 0.4, y: 0 }],
    [{ x: 0.1, y: 1 }, { x: 0.4, y: 1 }],
    makeArc(0.4, 0.5, 0.45, 0.5, -Math.PI / 2, Math.PI / 2),
  ],
  'E': [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    [{ x: 0.1, y: 0 }, { x: 0.85, y: 0 }],
    [{ x: 0.1, y: 0.5 }, { x: 0.65, y: 0.5 }],
    [{ x: 0.1, y: 1 }, { x: 0.85, y: 1 }],
  ],
  'F': [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    [{ x: 0.1, y: 0 }, { x: 0.85, y: 0 }],
    [{ x: 0.1, y: 0.5 }, { x: 0.65, y: 0.5 }],
  ],
  'G': [
    makeArc(0.55, 0.5, 0.42, 0.48, Math.PI * 0.2, Math.PI * 1.8),
    [{ x: 0.85, y: 0.5 }, { x: 0.55, y: 0.5 }],
    [{ x: 0.85, y: 0.5 }, { x: 0.85, y: 0.85 }],
  ],
  'H': [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    [{ x: 0.9, y: 0 }, { x: 0.9, y: 1 }],
    [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }],
  ],
  'I': [
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
    [{ x: 0.2, y: 0 }, { x: 0.8, y: 0 }],
    [{ x: 0.2, y: 1 }, { x: 0.8, y: 1 }],
  ],
  'J': [
    [{ x: 0.75, y: 0 }, { x: 0.75, y: 0.7 }],
    makeArc(0.45, 0.7, 0.3, 0.28, 0, Math.PI),
  ],
  'K': [
    [{ x: 0.1, y: 0 }, { x: 0.1, y: 1 }],
    [{ x: 0.85, y: 0 }, { x: 0.1, y: 0.55 }],
    [{ x: 0.35, y: 0.4 }, { x: 0.85, y: 1 }],
  ],
  'L': [
    [{ x: 0.15, y: 0 }, { x: 0.15, y: 1 }],
    [{ x: 0.15, y: 1 }, { x: 0.85, y: 1 }],
  ],
  'M': [
    [{ x: 0.1, y: 1 }, { x: 0.1, y: 0 }, { x: 0.5, y: 0.6 }, { x: 0.9, y: 0 }, { x: 0.9, y: 1 }],
  ],
  'N': [
    [{ x: 0.15, y: 1 }, { x: 0.15, y: 0 }, { x: 0.85, y: 1 }, { x: 0.85, y: 0 }],
  ],
  'O': [
    // True smooth continuous vector circle loop
    makeArc(0.5, 0.5, 0.42, 0.48, 0, Math.PI * 2, 24),
  ],
  'P': [
    [{ x: 0.15, y: 0 }, { x: 0.15, y: 1 }],
    makeArc(0.42, 0.3, 0.35, 0.3, -Math.PI / 2, Math.PI / 2),
    [{ x: 0.15, y: 0 }, { x: 0.42, y: 0 }],
    [{ x: 0.15, y: 0.6 }, { x: 0.42, y: 0.6 }],
  ],
  'Q': [
    makeArc(0.5, 0.5, 0.42, 0.48, 0, Math.PI * 2, 24),
    [{ x: 0.6, y: 0.68 }, { x: 0.9, y: 1 }],
  ],
  'R': [
    [{ x: 0.15, y: 0 }, { x: 0.15, y: 1 }],
    makeArc(0.42, 0.3, 0.35, 0.3, -Math.PI / 2, Math.PI / 2),
    [{ x: 0.15, y: 0 }, { x: 0.42, y: 0 }],
    [{ x: 0.15, y: 0.6 }, { x: 0.42, y: 0.6 }],
    [{ x: 0.42, y: 0.6 }, { x: 0.85, y: 1 }],
  ],
  'S': [
    [
      { x: 0.82, y: 0.2 },
      { x: 0.65, y: 0.05 },
      { x: 0.35, y: 0.05 },
      { x: 0.18, y: 0.22 },
      { x: 0.2, y: 0.4 },
      { x: 0.5, y: 0.5 },
      { x: 0.8, y: 0.62 },
      { x: 0.82, y: 0.8 },
      { x: 0.65, y: 0.95 },
      { x: 0.35, y: 0.95 },
      { x: 0.18, y: 0.8 },
    ],
  ],
  'T': [
    [{ x: 0.1, y: 0 }, { x: 0.9, y: 0 }],
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
  ],
  'U': [
    [{ x: 0.15, y: 0 }, { x: 0.15, y: 0.65 }],
    makeArc(0.5, 0.65, 0.35, 0.33, Math.PI, 0),
    [{ x: 0.85, y: 0.65 }, { x: 0.85, y: 0 }],
  ],
  'V': [
    [{ x: 0.1, y: 0 }, { x: 0.5, y: 1 }, { x: 0.9, y: 0 }],
  ],
  'W': [
    [{ x: 0.08, y: 0 }, { x: 0.28, y: 1 }, { x: 0.5, y: 0.4 }, { x: 0.72, y: 1 }, { x: 0.92, y: 0 }],
  ],
  'X': [
    [{ x: 0.15, y: 0 }, { x: 0.85, y: 1 }],
    [{ x: 0.85, y: 0 }, { x: 0.15, y: 1 }],
  ],
  'Y': [
    [{ x: 0.15, y: 0 }, { x: 0.5, y: 0.5 }],
    [{ x: 0.85, y: 0 }, { x: 0.5, y: 0.5 }],
    [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 1 }],
  ],
  'Z': [
    [{ x: 0.15, y: 0 }, { x: 0.85, y: 0 }, { x: 0.15, y: 1 }, { x: 0.85, y: 1 }],
  ],

  // Lowercase
  'a': [
    makeArc(0.5, 0.62, 0.32, 0.35, 0, Math.PI * 2, 20),
    [{ x: 0.82, y: 0.27 }, { x: 0.82, y: 0.97 }],
  ],
  'b': [
    [{ x: 0.18, y: 0 }, { x: 0.18, y: 0.97 }],
    makeArc(0.5, 0.62, 0.32, 0.35, -Math.PI / 2, Math.PI * 1.5, 20),
  ],
  'c': [
    makeArc(0.52, 0.62, 0.32, 0.35, Math.PI * 0.25, Math.PI * 1.75, 16),
  ],
  'd': [
    [{ x: 0.82, y: 0 }, { x: 0.82, y: 0.97 }],
    makeArc(0.5, 0.62, 0.32, 0.35, Math.PI / 2, Math.PI * 2.5, 20),
  ],
  'e': [
    [{ x: 0.18, y: 0.62 }, { x: 0.82, y: 0.62 }],
    makeArc(0.5, 0.62, 0.32, 0.35, 0, Math.PI * 1.85, 20),
  ],
  'f': [
    makeArc(0.65, 0.2, 0.25, 0.2, Math.PI, 0),
    [{ x: 0.4, y: 0.2 }, { x: 0.4, y: 0.97 }],
    [{ x: 0.2, y: 0.45 }, { x: 0.7, y: 0.45 }],
  ],
  'g': [
    makeArc(0.5, 0.55, 0.32, 0.3, 0, Math.PI * 2, 20),
    [{ x: 0.82, y: 0.25 }, { x: 0.82, y: 1.05 }],
    makeArc(0.52, 1.05, 0.3, 0.22, 0, Math.PI),
  ],
  'h': [
    [{ x: 0.18, y: 0 }, { x: 0.18, y: 0.97 }],
    makeArc(0.5, 0.58, 0.32, 0.32, Math.PI, 0),
    [{ x: 0.82, y: 0.58 }, { x: 0.82, y: 0.97 }],
  ],
  'i': [
    [{ x: 0.5, y: 0.35 }, { x: 0.5, y: 0.97 }],
    [{ x: 0.48, y: 0.15 }, { x: 0.52, y: 0.15 }],
  ],
  'j': [
    [{ x: 0.65, y: 0.35 }, { x: 0.65, y: 1.05 }],
    makeArc(0.42, 1.05, 0.23, 0.22, 0, Math.PI),
    [{ x: 0.63, y: 0.15 }, { x: 0.67, y: 0.15 }],
  ],
  'k': [
    [{ x: 0.18, y: 0 }, { x: 0.18, y: 0.97 }],
    [{ x: 0.78, y: 0.32 }, { x: 0.18, y: 0.7 }],
    [{ x: 0.42, y: 0.55 }, { x: 0.8, y: 0.97 }],
  ],
  'l': [
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 0.97 }],
  ],
  'm': [
    [{ x: 0.12, y: 0.3 }, { x: 0.12, y: 0.97 }],
    makeArc(0.34, 0.56, 0.22, 0.26, Math.PI, 0),
    [{ x: 0.56, y: 0.56 }, { x: 0.56, y: 0.97 }],
    makeArc(0.74, 0.56, 0.18, 0.26, Math.PI, 0),
    [{ x: 0.92, y: 0.56 }, { x: 0.92, y: 0.97 }],
  ],
  'n': [
    [{ x: 0.18, y: 0.3 }, { x: 0.18, y: 0.97 }],
    makeArc(0.5, 0.56, 0.32, 0.26, Math.PI, 0),
    [{ x: 0.82, y: 0.56 }, { x: 0.82, y: 0.97 }],
  ],
  'o': [
    // True smooth circular loop
    makeArc(0.5, 0.62, 0.32, 0.35, 0, Math.PI * 2, 22),
  ],
  'p': [
    [{ x: 0.18, y: 0.3 }, { x: 0.18, y: 1.25 }],
    makeArc(0.5, 0.62, 0.32, 0.32, -Math.PI / 2, Math.PI * 1.5, 20),
  ],
  'q': [
    [{ x: 0.82, y: 0.3 }, { x: 0.82, y: 1.25 }],
    makeArc(0.5, 0.62, 0.32, 0.32, Math.PI / 2, Math.PI * 2.5, 20),
  ],
  'r': [
    [{ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.97 }],
    makeArc(0.5, 0.55, 0.3, 0.25, Math.PI, Math.PI * 0.1),
  ],
  's': [
    [
      { x: 0.78, y: 0.42 },
      { x: 0.62, y: 0.3 },
      { x: 0.38, y: 0.3 },
      { x: 0.22, y: 0.44 },
      { x: 0.25, y: 0.58 },
      { x: 0.5, y: 0.65 },
      { x: 0.75, y: 0.72 },
      { x: 0.78, y: 0.85 },
      { x: 0.62, y: 0.97 },
      { x: 0.35, y: 0.97 },
      { x: 0.22, y: 0.85 },
    ],
  ],
  't': [
    [{ x: 0.45, y: 0.12 }, { x: 0.45, y: 0.85 }],
    makeArc(0.65, 0.85, 0.2, 0.12, Math.PI, 0),
    [{ x: 0.25, y: 0.35 }, { x: 0.75, y: 0.35 }],
  ],
  'u': [
    [{ x: 0.2, y: 0.3 }, { x: 0.2, y: 0.75 }],
    makeArc(0.5, 0.75, 0.3, 0.22, Math.PI, 0),
    [{ x: 0.8, y: 0.3 }, { x: 0.8, y: 0.97 }],
  ],
  'v': [
    [{ x: 0.15, y: 0.3 }, { x: 0.5, y: 0.97 }, { x: 0.85, y: 0.3 }],
  ],
  'w': [
    [{ x: 0.1, y: 0.3 }, { x: 0.3, y: 0.97 }, { x: 0.5, y: 0.55 }, { x: 0.7, y: 0.97 }, { x: 0.9, y: 0.3 }],
  ],
  'x': [
    [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.97 }],
    [{ x: 0.8, y: 0.3 }, { x: 0.2, y: 0.97 }],
  ],
  'y': [
    [{ x: 0.18, y: 0.3 }, { x: 0.5, y: 0.75 }],
    [{ x: 0.82, y: 0.3 }, { x: 0.25, y: 1.25 }],
  ],
  'z': [
    [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }, { x: 0.2, y: 0.97 }, { x: 0.8, y: 0.97 }],
  ],

  // Numbers
  '0': [
    makeArc(0.5, 0.5, 0.4, 0.48, 0, Math.PI * 2, 24),
    [{ x: 0.78, y: 0.18 }, { x: 0.22, y: 0.82 }],
  ],
  '1': [
    [{ x: 0.25, y: 0.25 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
    [{ x: 0.2, y: 1 }, { x: 0.8, y: 1 }],
  ],
  '2': [
    makeArc(0.5, 0.28, 0.36, 0.28, Math.PI, 0),
    [{ x: 0.86, y: 0.28 }, { x: 0.15, y: 1 }, { x: 0.85, y: 1 }],
  ],
  '3': [
    makeArc(0.48, 0.28, 0.36, 0.26, -Math.PI / 2, Math.PI / 2),
    makeArc(0.48, 0.72, 0.36, 0.28, -Math.PI / 2, Math.PI * 0.7),
  ],
  '4': [
    [{ x: 0.75, y: 1 }, { x: 0.75, y: 0 }, { x: 0.15, y: 0.65 }, { x: 0.9, y: 0.65 }],
  ],
  '5': [
    [{ x: 0.8, y: 0 }, { x: 0.2, y: 0 }, { x: 0.18, y: 0.45 }],
    makeArc(0.48, 0.68, 0.36, 0.3, -Math.PI / 2, Math.PI * 0.7),
  ],
  '6': [
    makeArc(0.5, 0.66, 0.36, 0.32, 0, Math.PI * 2, 20),
    [{ x: 0.14, y: 0.66 }, { x: 0.6, y: 0 }],
  ],
  '7': [
    [{ x: 0.15, y: 0 }, { x: 0.85, y: 0 }, { x: 0.35, y: 1 }],
  ],
  '8': [
    makeArc(0.5, 0.26, 0.3, 0.25, 0, Math.PI * 2, 20),
    makeArc(0.5, 0.72, 0.38, 0.27, 0, Math.PI * 2, 20),
  ],
  '9': [
    makeArc(0.5, 0.34, 0.36, 0.32, 0, Math.PI * 2, 20),
    [{ x: 0.86, y: 0.34 }, { x: 0.4, y: 1 }],
  ],

  // Punctuation
  '.': [makeArc(0.5, 0.92, 0.08, 0.08, 0, Math.PI * 2, 10)],
  ',': [[{ x: 0.5, y: 0.88 }, { x: 0.5, y: 0.96 }, { x: 0.35, y: 1.1 }]],
  ':': [
    makeArc(0.5, 0.4, 0.08, 0.08, 0, Math.PI * 2, 10),
    makeArc(0.5, 0.85, 0.08, 0.08, 0, Math.PI * 2, 10),
  ],
  ';': [
    makeArc(0.5, 0.4, 0.08, 0.08, 0, Math.PI * 2, 10),
    [{ x: 0.5, y: 0.85 }, { x: 0.5, y: 0.93 }, { x: 0.35, y: 1.05 }],
  ],
  '-': [[{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }]],
  '+': [
    [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }],
    [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }],
  ],
  '=': [
    [{ x: 0.2, y: 0.38 }, { x: 0.8, y: 0.38 }],
    [{ x: 0.2, y: 0.62 }, { x: 0.8, y: 0.62 }],
  ],
  '/': [[{ x: 0.15, y: 1 }, { x: 0.85, y: 0 }]],
  '(': [makeArc(0.7, 0.5, 0.35, 0.48, Math.PI * 0.7, Math.PI * 1.3)],
  ')': [makeArc(0.3, 0.5, 0.35, 0.48, -Math.PI * 0.3, Math.PI * 0.3)],
  '!': [
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 0.68 }],
    makeArc(0.5, 0.92, 0.08, 0.08, 0, Math.PI * 2, 10),
  ],
  '?': [
    makeArc(0.5, 0.3, 0.32, 0.28, Math.PI, 0),
    [{ x: 0.82, y: 0.3 }, { x: 0.5, y: 0.6 }, { x: 0.5, y: 0.72 }],
    makeArc(0.5, 0.92, 0.08, 0.08, 0, Math.PI * 2, 10),
  ],
  '#': [
    [{ x: 0.35, y: 0 }, { x: 0.25, y: 1 }],
    [{ x: 0.75, y: 0 }, { x: 0.65, y: 1 }],
    [{ x: 0.1, y: 0.35 }, { x: 0.9, y: 0.35 }],
    [{ x: 0.1, y: 0.65 }, { x: 0.9, y: 0.65 }],
  ],
  '&': [
    [
      { x: 0.85, y: 0.88 },
      { x: 0.5, y: 0.5 },
      { x: 0.65, y: 0.25 },
      { x: 0.45, y: 0.08 },
      { x: 0.3, y: 0.22 },
      { x: 0.32, y: 0.4 },
      { x: 0.85, y: 0.88 },
    ],
    [
      { x: 0.5, y: 0.5 },
      { x: 0.15, y: 0.75 },
      { x: 0.35, y: 0.98 },
      { x: 0.65, y: 0.92 },
      { x: 0.9, y: 0.7 },
    ],
  ],
};

/**
 * Generate genuine continuous vector toolpaths for multi-line paragraph text.
 * Each character is drawn with smooth continuous vector loops and lines.
 */
export function generateVectorTextPaths(
  text: string,
  fontSizeMm: number,
  penId: string,
  options: {
    isBold?: boolean;
    isItalic?: boolean;
    isUnderline?: boolean;
    textAlign?: 'left' | 'center' | 'right';
    lineHeight?: number;
    fillStyle?: 'outline' | 'hatch' | 'crosshatch' | 'stipple';
    penDiameter?: number;
  }
): PathSegment[] {
  if (!text || !text.trim()) return [];

  const charHeight = fontSizeMm;
  const charWidth = fontSizeMm * 0.62;
  const charSpacing = fontSizeMm * 0.2;
  const lineSpacing = fontSizeMm * (options.lineHeight || 1.4);
  const italicShear = options.isItalic ? 0.25 : 0.0;
  const boldOffset = options.isBold ? Math.max(0.15, (options.penDiameter || 0.7) * 0.4) : 0;

  const lines = text.split('\n');
  const segments: PathSegment[] = [];

  let curY = 0;

  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    const totalLineWidth = line.length * (charWidth + charSpacing) - charSpacing;

    let startX = 0;
    if (options.textAlign === 'center') {
      startX = -totalLineWidth / 2;
    } else if (options.textAlign === 'right') {
      startX = -totalLineWidth;
    }

    let curX = startX;

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];

      if (ch === ' ') {
        curX += charWidth + charSpacing;
        continue;
      }

      const glyph = GLYPHS[ch] || GLYPHS[ch.toUpperCase()] || null;

      if (glyph) {
        // Render passes: 1 pass for regular, 2 passes offset for bold
        const passes = options.isBold ? [0, boldOffset] : [0];

        for (const bOffset of passes) {
          for (const stroke of glyph) {
            const transformedPoints: Point2D[] = stroke.map((pt) => {
              // Apply affine transform: scale, shear for italic, offset
              const xShear = (1 - pt.y) * italicShear * charWidth;
              return {
                x: curX + pt.x * charWidth + xShear + bOffset,
                y: curY + pt.y * charHeight + bOffset,
              };
            });

            if (transformedPoints.length > 1) {
              segments.push({
                points: transformedPoints,
                penId,
              });
            } else if (transformedPoints.length === 1) {
              segments.push({
                points: transformedPoints,
                penId,
                isPeck: true,
              });
            }
          }
        }
      }

      curX += charWidth + charSpacing;
    }

    // Draw continuous underline if enabled
    if (options.isUnderline && line.trim()) {
      const underlineY = curY + charHeight * 1.15;
      segments.push({
        points: [
          { x: startX, y: underlineY },
          { x: startX + totalLineWidth, y: underlineY },
        ],
        penId,
      });
      if (options.isBold) {
        segments.push({
          points: [
            { x: startX, y: underlineY + boldOffset },
            { x: startX + totalLineWidth, y: underlineY + boldOffset },
          ],
          penId,
        });
      }
    }

    curY += lineSpacing;
  }

  return segments;
}
