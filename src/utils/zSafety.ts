import { PrinterModel, ZCalibration, ZDatumSource } from '../types/plotter';

/**
 * Z-axis safety policy — simplified bed-stop model.
 *
 * The operator homes the printer, jogs the toolhead down until it physically
 * stops at the bed, then captures that height once. From then on:
 *
 *   draw plane = captured bed reference + 1 mm   (fixed, not editable)
 *   travel     = draw plane + pen release (1–3 mm)
 *
 * The printer's own firmware stops the head at the bed, so the capture step is
 * safe. After capture, the software refuses to command anything below the
 * fixed draw plane.
 */
export const Z_SAFETY = {
  /** Fixed nozzle-to-bed clearance for the drawing plane. */
  BED_CLEARANCE_MM: 3.0,
  /** Pen release / travel lift above the drawing plane. */
  MIN_PEN_RELEASE_MM: 1.0,
  MAX_PEN_RELEASE_MM: 3.0,
  DEFAULT_PEN_RELEASE_MM: 2.0,
  /** Absolute machine floor while calibrating (never negative). */
  ABSOLUTE_MIN_Z_MM: 0,
  /** Tolerance used when comparing floating point Z heights. */
  EPSILON_MM: 0.001,
} as const;

const DATUM_SOURCES: ZDatumSource[] = ['none', 'bed_stop'];

function asFiniteNumber(value: unknown, fallback: number): number {
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(num) ? num : fallback;
}

function isDatumSource(value: unknown): value is ZDatumSource {
  return typeof value === 'string' && (DATUM_SOURCES as string[]).includes(value);
}

export function createDefaultZCalibration(): ZCalibration {
  return {
    bedReferenceZ: Z_SAFETY.ABSOLUTE_MIN_Z_MM,
    penReleaseMm: Z_SAFETY.DEFAULT_PEN_RELEASE_MM,
    isCalibrated: false,
    datumSource: 'none',
    datumCapturedAt: null,
  };
}

export function clampPenRelease(raw: unknown): number {
  const value = asFiniteNumber(raw, Z_SAFETY.DEFAULT_PEN_RELEASE_MM);
  return Math.min(
    Z_SAFETY.MAX_PEN_RELEASE_MM,
    Math.max(Z_SAFETY.MIN_PEN_RELEASE_MM, value)
  );
}

/** Captured physical bed height (absolute machine Z). */
export function getBedReference(cal: ZCalibration | null | undefined): number {
  if (!cal) return Z_SAFETY.ABSOLUTE_MIN_Z_MM;
  return Math.max(
    Z_SAFETY.ABSOLUTE_MIN_Z_MM,
    asFiniteNumber(cal.bedReferenceZ, Z_SAFETY.ABSOLUTE_MIN_Z_MM)
  );
}

/** Fixed drawing plane: exactly 1 mm above the captured bed reference. */
export function getDrawZ(cal: ZCalibration | null | undefined): number {
  return getBedReference(cal) + Z_SAFETY.BED_CLEARANCE_MM;
}

/** Travel plane: draw plane + configurable pen release (1–3 mm). */
export function getTravelZ(cal: ZCalibration | null | undefined): number {
  return getDrawZ(cal) + clampPenRelease(cal?.penReleaseMm);
}

/**
 * Hard floor for normal operation: the fixed draw plane. Before calibration the
 * floor is the absolute minimum so the operator can jog down to the bed stop.
 */
export function getZFloor(cal: ZCalibration | null | undefined): number {
  if (cal && isZSafeToPlot(cal)) return getDrawZ(cal);
  return Z_SAFETY.ABSOLUTE_MIN_Z_MM;
}

export function normalizeZCalibration(
  raw: Partial<ZCalibration> | null | undefined,
  _model?: PrinterModel
): ZCalibration {
  const source = raw || {};

  // Legacy calibrations used an editable draw height. They are not compatible
  // with the bed-stop model, so force a fresh capture instead of guessing.
  const isLegacy = !('bedReferenceZ' in source) && ('zDrawOffset' in source || 'travelLiftZ' in source);

  const rawBed = asFiniteNumber(source.bedReferenceZ, Z_SAFETY.ABSOLUTE_MIN_Z_MM);
  const bedReferenceZ = Math.max(Z_SAFETY.ABSOLUTE_MIN_Z_MM, rawBed);

  const sourceDatum: ZDatumSource = isDatumSource(source.datumSource)
    ? source.datumSource
    : 'none';

  const calibrated =
    !isLegacy &&
    Boolean(source.isCalibrated) &&
    sourceDatum === 'bed_stop' &&
    Number.isFinite(rawBed);

  return {
    bedReferenceZ,
    penReleaseMm: clampPenRelease(source.penReleaseMm),
    isCalibrated: calibrated,
    datumSource: calibrated ? 'bed_stop' : 'none',
    datumCapturedAt: source.datumCapturedAt ?? null,
  };
}

/** True when the bed reference exists and the fixed draw plane is valid. */
export function isZSafeToPlot(cal: ZCalibration | null | undefined): boolean {
  return Boolean(
    cal &&
      cal.isCalibrated &&
      cal.datumSource === 'bed_stop' &&
      Number.isFinite(cal.bedReferenceZ)
  );
}

/** Human readable reason why plotting is blocked, or null when it is safe. */
export function getZBlockReason(cal: ZCalibration | null | undefined): string | null {
  if (!isZSafeToPlot(cal)) {
    return 'No bed reference captured. Home the printer, jog down to the bed stop, then press "Capture Bed Reference".';
  }
  return null;
}

/**
 * Parse every Z word in a G0/G1/G2/G3 line and confirm none of them go below
 * the floor. Used as the last software line of defence before publishing.
 */
export function findUnsafeZMove(
  gcode: string,
  floor: number
): { z: number; line: string } | null {
  const line = (gcode || '').split('\n')[0]?.trim() || '';
  if (!/^\s*G0?[0-3](\s|$)/i.test(line)) return null;
  if (/^\s*(G28|G29|G92)/i.test(line)) return null;

  const zMatches = [...line.matchAll(/[Zz]\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g)];
  for (const match of zMatches) {
    const z = parseFloat(match[1]);
    if (
      Number.isFinite(z) &&
      z < Math.max(Z_SAFETY.ABSOLUTE_MIN_Z_MM, floor) - Z_SAFETY.EPSILON_MM
    ) {
      return { z, line };
    }
  }
  return null;
}
