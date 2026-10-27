import {
  SlicedPlotJob,
  PrinterModel,
  PRINTER_SPECS,
  PenOffset,
  ZCalibration,
  QualityPreset,
  QUALITY_PRESETS,
  PaperBounds,
} from '../types/plotter';
import {
  Z_SAFETY,
  clampPenRelease,
  getBedReference,
  getDrawZ,
  getTravelZ,
  getZBlockReason,
  getZFloor,
  isZSafeToPlot,
} from '../utils/zSafety';

export interface GcodeGenerationOptions {
  model: PrinterModel;
  job: SlicedPlotJob;
  penOffset: PenOffset;
  zCalibration: ZCalibration;
  quality: QualityPreset;
  paperBounds?: PaperBounds;
  syncAllSpeeds?: boolean;
}

export function generateBambuPlotterGcode(options: GcodeGenerationOptions): {
  gcode: string;
  totalCommands: number;
  warnings: string[];
} {
  const { model, job, penOffset, zCalibration, quality, syncAllSpeeds = false } = options;
  const spec = PRINTER_SPECS[model];
  const qSettings = QUALITY_PRESETS[quality];

  const lines: string[] = [];
  const warnings: string[] = [];
  let commandCount = 0;

  const drawZ = getDrawZ(zCalibration);
  const travelZ = getTravelZ(zCalibration);
  const zFloor = getZFloor(zCalibration);
  const zBlockReason = getZBlockReason(zCalibration);

  if (zBlockReason) warnings.push(zBlockReason);
  if (!isZSafeToPlot(zCalibration)) {
    warnings.push('UNSAFE EXPORT: no captured bed reference. Run the setup wizard first.');
  }

  function emit(cmd: string, comment?: string) {
    if (comment) {
      lines.push(`${cmd.padEnd(28)} ; ${comment}`);
    } else {
      lines.push(cmd);
    }
    commandCount++;
  }

  // File Header
  lines.push('; ==============================================================');
  lines.push(`; Bambu Plotter Studio G-Code Export`);
  lines.push(`; Printer Model: ${spec.name}`);
  lines.push(`; Printable Bed Size: ${spec.width} x ${spec.depth} mm`);
  lines.push(`; Quality Preset: ${qSettings.name} (${qSettings.drawFeedrate / 60} mm/s)`);
  lines.push(`; Pen Offset: X=${penOffset.x.toFixed(2)}mm, Y=${penOffset.y.toFixed(2)}mm`);
  lines.push(`; Z Bed Reference: ${getBedReference(zCalibration).toFixed(2)}mm`);
  lines.push(`; Z Draw Plane: ${drawZ.toFixed(2)}mm (bed + ${Z_SAFETY.BED_CLEARANCE_MM.toFixed(1)}mm, fixed)`);
  lines.push(`; Pen Release Lift: ${clampPenRelease(zCalibration.penReleaseMm).toFixed(2)}mm`);
  lines.push(`; Z Travel Plane: ${travelZ.toFixed(2)}mm`);
  lines.push(`; Z Hard Floor: ${zFloor.toFixed(2)}mm — no move may go below this`);
  lines.push(`; Z Datum Source: ${zCalibration.datumSource || 'none'}`);
  lines.push(';');
  lines.push('; SAFETY: this file intentionally does NOT call G28/G29. Homing uses the');
  lines.push('; nozzle as a probe and would crush a loosely seated pen. Establish the bed');
  lines.push('; reference in the app before running this file.');
  lines.push('; ==============================================================\n');

  // Initialization & Safety
  emit('G21', 'Set units to millimeters');
  emit('G90', 'Absolute positioning mode');
  emit('M83', 'Relative extruder mode');
  emit('M104 S0', 'Disable hotend heating (cold plotting)');
  emit('M140 S0', 'Disable bed heating');
  emit('M106 S0', 'Turn off cooling fan');

  // Establish relative travel height BEFORE any XY move. No homing: the Z
  // datum is provided by the software calibration and is never re-derived.
  emit(
    `G0 Z${travelZ.toFixed(2)} F${qSettings.zLiftFeedrate}`,
    'Raise to travel plane (no homing)'
  );

  // Iterate over each pen color group
  job.layersByPen.forEach((layer, layerIdx) => {
    const pen = layer.pen;
    lines.push('\n; --------------------------------------------------------------');
    lines.push(`; PEN LAYER ${layerIdx + 1}/${job.layersByPen.length}: ${pen.name} (${pen.hex})`);
    lines.push(`; Tip Diameter: ${pen.diameter}mm`);
    lines.push('; --------------------------------------------------------------');

    // Pen-change pause at start of each layer/color.
    // Deliberately NO G28 Z: re-homing touches the nozzle to the bed and
    // dislodges the loosely seated pen. The software draw plane is preserved.
    if (job.layersByPen.length > 1) {
      emit('M400', 'Wait for buffer moves to complete');
      // Move to front-center park position at the travel plane
      const parkX = Math.round(spec.width / 2);
      const parkY = 15;
      emit(
        `G0 Z${travelZ.toFixed(2)} F${qSettings.zLiftFeedrate}`,
        'Lift to travel plane (datum preserved, no homing)'
      );
      emit(`G0 X${parkX} Y${parkY} F${qSettings.travelFeedrate}`, 'Move to front service park position');

      emit(
        `G0 Z${drawZ.toFixed(2)} F${qSettings.zLiftFeedrate}`,
        'Descend to the exact calibrated draw plane for pen seating'
      );
      emit(`M0 Insert [${pen.name}] until touching paper & press Resume`, 'Pause for manual pen seating');
    }

    // Process strokes
    layer.strokeSegments.forEach((segment) => {
      if (segment.points.length === 0) return;

      const p0 = segment.points[0];

      // Convert pen target to machine coordinates
      const machineX0 = p0.x - penOffset.x;
      const machineY0 = p0.y - penOffset.y;

      // Check bounds
      if (
        machineX0 < 0 ||
        machineX0 > spec.width ||
        machineY0 < 0 ||
        machineY0 > spec.depth
      ) {
        warnings.push(`Stroke out of machine bounds at (${p0.x.toFixed(1)}, ${p0.y.toFixed(1)})`);
      }

      // Rapid move to start of stroke (Pen UP)
      emit(
        `G0 X${machineX0.toFixed(2)} Y${machineY0.toFixed(2)} F${qSettings.travelFeedrate}`,
        'Travel move with pen lifted'
      );

      if (segment.isPeck) {
        // Stipple dot pecking: rapid plunge and lift
        emit(
          `G1 Z${drawZ.toFixed(2)} F${qSettings.zLiftFeedrate}`,
          'Stipple dot plunge'
        );
        emit(
          `G0 Z${travelZ.toFixed(2)} F${qSettings.zLiftFeedrate}`,
          'Stipple dot lift'
        );
      } else {
        // Lower pen to drawing surface
        emit(
          `G1 Z${drawZ.toFixed(2)} F${qSettings.zLiftFeedrate}`,
          'Lower pen to drawing surface'
        );

        // Draw path points with per-object quality speed or global speed
        const activePreset = (!syncAllSpeeds && segment.qualityPreset) ? segment.qualityPreset : quality;
        const activeFeedrate = QUALITY_PRESETS[activePreset]?.drawFeedrate || qSettings.drawFeedrate;

        for (let ptIdx = 1; ptIdx < segment.points.length; ptIdx++) {
          const pt = segment.points[ptIdx];
          const mX = pt.x - penOffset.x;
          const mY = pt.y - penOffset.y;
          emit(
            `G1 X${mX.toFixed(2)} Y${mY.toFixed(2)} F${activeFeedrate}`,
            `Draw stroke (${QUALITY_PRESETS[activePreset]?.name || 'Standard'})`
          );
        }

        // Lift pen at end of stroke
        emit(
          `G0 Z${travelZ.toFixed(2)} F${qSettings.zLiftFeedrate}`,
          'Lift pen at stroke finish'
        );
      }
    });
  });

  // Plot completion footer
  lines.push('\n; ==============================================================');
  lines.push('; Plot Finish Routine');
  lines.push('; ==============================================================');
  emit('M400', 'Wait for current moves');
  emit(
    `G0 Z${Math.min(spec.height, Math.max(40, travelZ)).toFixed(2)} F${qSettings.zLiftFeedrate}`,
    'Lift toolhead safe distance (above floor)'
  );
  // Present bed by moving it forward
  emit(`G0 X10 Y${(spec.depth - 10).toFixed(0)} F${qSettings.travelFeedrate}`, 'Present drawn page to user');
  emit('M84', 'Disable stepper motors');
  emit('M107', 'Turn off fans');

  return {
    gcode: lines.join('\n'),
    totalCommands: commandCount,
    warnings,
  };
}
