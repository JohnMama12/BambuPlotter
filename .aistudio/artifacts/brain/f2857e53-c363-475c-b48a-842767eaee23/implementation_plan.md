# Bambu Plotter Studio: Comprehensive Architectural Overhaul & Production Reliability Plan

Eliminate all risks of printer bed damage, replace out-of-place 3D printing jargon with plotter-native vector hatching, provide aspect-ratio-preserving SVG import placement, and resolve Bambu firmware Z-repositioning and floating nozzle quirks.

---

## User Review & Clarified Directives

> [!IMPORTANT]
> **Summary of Confirmed Choices & Critical Directives:**
> 1. **Floating Nozzle Architecture (Zero Nozzle-to-Bed Proximity)**:
>    - The hotend nozzle must **significantly float high in the air** (e.g. 20mm–30mm above the bed) throughout the entire plotting session. The nozzle should NEVER approach the drawing plane.
>    - The pen is mounted in the bracket extending far below the nozzle so that only the pen tip contacts the paper while the hotend remains completely clear of the bed.
>    - **No Hardcoded Assumed Offsets**: The system does NOT assume that 0,0,0 is touching the bed or hardcode a 4.5mm offset.
> 2. **Mitigating the Bambu Firmware Recentering & Z-Drift Quirk**:
>    - **The Cause**: Bambu A1 firmware runs dynamic Auto Bed Leveling (ABL) mesh compensation and internal soft-endstop tramming. When a Z move is commanded, if mesh leveling is active or modal states (`G90`/`G91`) are desynchronized, the printer recalculates its bed tilt matrix at the current XY coordinate and shifts the Z height or performs an internal realignment move. Furthermore, post-homing clearance routines on the A1 park the nozzle at ~4.5mm above the bed.
>    - **The Solution**:
>      1. **Disable Mesh Leveling (`G29.2 S0` & `M420 S0`)**: Strips dynamic mesh height recalculation so the Z axis becomes purely linear, flat, and rigid across the entire XY plane.
>      2. **Strict Planner Flush (`M400`)**: Execute `M400` synchronization barriers before and after setting any datum or moving Z to ensure the stepper queue is completely at rest and prevent firmware recalculation jumps.
>      3. **Relative Work Coordinate Zero (`G92 Z0`) at Hover Height**: Anchor the drawing plane directly at the user-verified physical pen contact height while the nozzle floats high above.
>      4. **Atomic Move Commands**: All G-code commands explicitly specify absolute positioning (`G90`), feedrate, and units (`G21`) so firmware defaults never trigger unexpected relative hops or recentering.
> 3. **Plotter-Native Hatching & Density Controls**:
>    - Plotter-standard terminology: **Parallel Hatch**, **Crosshatch Matrix**, **Concentric Loops**, and **Contour Outline**.
>    - Explicit **Hatch Angle** (0°–180° with 0°, 45°, 90° presets) and **Line Spacing / Density** controls (0.2mm to 5.0mm) for all closed shapes (Circle, Rect, Text, SVG) with live canvas visualization.
> 4. **SVG Import Placement Modal**:
>    - Interactive **SVG Placement Modal** offering:
>      - *Fit to Calibrated Paper* (proportional scale centered inside paper bounds)
>      - *Fit to Printable Bed* (proportional scale within 180×180 or 256×256 mm)
>      - *Original Dimensions (1:1 mm)* (respecting SVG native mm/pt dimensions)
>      - Pen color and hatch style assignment before placing on canvas.
> 5. **Connection & Telemetry Cleanup**:
>    - Neutral placeholders (`192.168.1.xxx`, `0300...`), clear empty state, and stored user settings.
>    - Dead-reckoning coordinate tracking and emergency pen lift (`G0 Z10 F1800`).

---

## 1. Technical Deep Dive: Floating Nozzle & Z-Recenter Mitigation

### The 4.5mm Anomaly & Firmware Recentering
On the Bambu Lab A1 and A1 Mini:
1. **Post-Homing Clearance**: After completing the strain-gauge homing sequence (`G28`), the printer's internal firmware macro automatically lifts the toolhead to a safe park clearance (typically ~4.5mm above the bed) to prevent dragging the nozzle across the textured PEI plate. The firmware's internal machine coordinate system (MCS) does not equate post-home rest with physical bed contact.
2. **Dynamic Mesh Recalculation (The "Recentering" Quirk)**: When the printer is sent a Z move command, if bed leveling mesh compensation is active, the motion planner calculates $Z_{actual} = Z_{commanded} + \text{mesh\_offset}(X, Y)$. As the toolhead moves across the bed, or when a move is executed while coordinates are re-evaluated, the printer adjusts the Z stepper dynamically to compensate for bed tilt. In 3D printing, this keeps layers uniform; in pen plotting, it causes the pen height to float or press unevenly across different parts of the paper!
3. **Motion Buffer Desynchronization**: Sending coordinate changes while prior moves are still in the firmware's planner buffer causes Bambu's proprietary interpreter to sync coordinate systems mid-stroke, resulting in unexpected vertical hops.

### The Zero-Nozzle-Collision Protocol
To guarantee the hotend nozzle floats safely 20mm–30mm in the air and never approaches the bed:
```
[Step 1: Bare Homing] ──> [Step 2: Lift to Hover] ──> [Step 3: Disable ABL Mesh] ──> [Step 4: Gravity Drop & Clamp] ──> [Step 5: G92 Z0 Datum Lock]
  (Pen removed,             (Toolhead parks at         (G29.2 S0 + M420 S0 to        (Pen drops gently to paper;    (M400 -> G92 Z0 -> M400;
   nozzle probes bed)        Z=25mm-30mm high)          freeze Z plane rigidly)        nozzle stays 25mm+ high)       paper is 0, travel is +4mm)
```

1. **Bare-Nozzle Baseline (G28)**: Performed ONLY when the pen clamp is empty. Sets true machine endstops.
2. **Command Toolhead to Safe High Hover**:
   - `G0 Z25 F1500` (or user-chosen clearance between 20mm–35mm).
   - Hotend nozzle is now floating ~25mm above the bed.
3. **Disable Mesh & Leveling Recalculation**:
   - `M400` (flush queue).
   - `G29.2 S0` (disable Bambu auto-bed-level mesh compensation).
   - `M420 S0` (disable Marlin leveling matrix).
   - `M400`.
4. **Zero-Downforce Pen Seating**:
   - With the nozzle floating high at `Z=25mm`, the user inserts the pen into the clamp.
   - User loosens the clamp thumbscrew. The pen tip naturally slides down under gravity until it touches the paper sheet.
   - User tightens the clamp thumbscrew. The nozzle is still floating 25mm above the bed; only the pen tip is touching paper! Zero downward force is applied to the bed.
5. **Establish Software Datum (G92 Z0)**:
   - Send `M400\nG92 Z0\nM400\n`.
   - Now, current pen contact is defined as `Z=0.00mm`.
   - The nozzle remains 25mm above the bed.
   - Pen Travel moves to `Z=3.5mm` to `5.0mm` (Pen UP).
   - Pen Draw moves to `Z=0.00mm` (Pen DOWN).
   - Because mesh compensation is disabled, the Z height will never drift or recenter during plotting!

---

## 2. Component Implementation Map

### A. Core Engine & Safety (`zSafety.ts`, `server.ts`, `bambuService.ts`, `gcodeGenerator.ts`)
- **`zSafety.ts`**:
  - Remove all hardcoded 4.5mm assumptions.
  - Implement dynamic Hover Seating Plane (`hoverZMm`, default 25.0mm, configurable).
  - Software hard floor: any move with $Z < 0.00$ relative to paper datum is strictly rejected.
- **`bambuService.ts`**:
  - `safeHomeNoPen()`: Enforces pen removal confirmation before sending `G28`.
  - `prepareHoverSeating(hoverHeight)`: Moves to $X_{\text{center}}, Y_{\text{front}}, Z_{\text{hover}}$ and sends `M400\nG29.2 S0\nM420 S0\nM400\n`.
  - `lockPaperZeroG92(travelLift)`: Sends `M400\nG92 Z0\nM400\nG0 Z${travelLift} F1500\n`.
- **`gcodeGenerator.ts`**:
  - Cold start headers: `M104 S0`, `M140 S0`, `M106 S0`.
  - Disable leveling: `G29.2 S0` and `M420 S0`.
  - Explicit modal state: `G90`, `G21`, `M83`.
  - Travel moves: `G0 Z${travelZ} F1800`.
  - Draw moves: `G1 Z0.00 F1200`.

### B. Setup Wizard Modal (`SetupWizardModal.tsx`)
- Step 1: Safety Check — verify pen is removed from clamp.
- Step 2: Bare Homing (`G28`) to set stepper limits.
- Step 3: Hover Station — Toolhead lifts to safe floating height (`Z=25mm`). Mesh compensation disabled.
- Step 4: Gravity Drop & Clamp — User drops pen gently to paper, clamps it, and clicks "Lock Paper Zero (G92 Z0)".
- Step 5: Test Lift / Drop — Executes a single 4mm lift and return to verify movement without Z-drift.

### C. Inspector Panel & Hatching (`InspectorPanel.tsx`, `slicerEngine.ts`, `types/plotter.ts`)
- Rename to **Plotter Fill & Hatching Engine**:
  - **Parallel Hatch** (linear sweep)
  - **Crosshatch Matrix** (dual orthogonal sweep)
  - **Concentric Loops** (inward nested rings)
  - **Contour Outline Only**
- **Hatch Angle**: Slider 0° to 180° with 0°, 45°, 90° quick presets.
- **Line Spacing / Density**: Number input in mm (0.2mm to 5.0mm).

### D. SVG Import Modal (`SvgImportModal.tsx`, `App.tsx`)
- Reads SVG natural aspect ratio and dimensions.
- 3 Placement Options:
  1. *Fit inside Paper Bounds* (proportional, centered)
  2. *Fit inside Printable Bed* (proportional, centered)
  3. *Original 1:1 Scale*
- Pre-assign pen and hatch pattern.

### E. Connection & Telemetry Cleanup (`ConnectionModal.tsx`, `TelemetryDrawer.tsx`)
- Clean placeholders in Connection Modal.
- Live dead-reckoning coordinate display in Telemetry Drawer.
- Protected homing trigger and **Emergency Lift Pen** (`G0 Z10`) button.

---

## 3. Verification & Safety Checklist

- [ ] **Nozzle Floating Clearance**: Verify nozzle remains $\ge 20\text{mm}$ above bed while pen tip draws on paper.
- [ ] **Zero Recenter Drift**: Verify that disabling `G29.2 S0` and inserting `M400` barriers completely eliminates Z shifts across XY coordinates.
- [ ] **Negative Z Rejection**: Verify commands attempting $Z < 0$ are blocked.
- [ ] **Hatch Angle & Spacing**: Verify custom angles (0°, 45°, 90°) and line spacing reflect accurately on canvas and in G-code.
- [ ] **SVG Aspect Ratio**: Verify SVGs scale without distortion and center on paper.
- [ ] **Build Validation**: Ensure `compile_applet` and `lint_applet` pass without errors.
