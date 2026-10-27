import {
  MachineTelemetry,
  SlicedPlotJob,
  PenOffset,
  ZCalibration,
  PrinterModel,
  PRINTER_SPECS,
  QUALITY_PRESETS,
  QualityPreset,
  MachineExecutionState,
} from '../types/plotter';
import {
  Z_SAFETY,
  createDefaultZCalibration,
  findUnsafeZMove,
  getDrawZ,
  getTravelZ,
  getZBlockReason,
  getZFloor,
  isZSafeToPlot,
  normalizeZCalibration,
  clampPenRelease,
} from '../utils/zSafety';

export type TelemetryCallback = (telemetry: MachineTelemetry) => void;
export type DrawnStrokeCallback = (x1: number, y1: number, x2: number, y2: number, colorHex: string, diameter: number) => void;
export type DrawnDotCallback = (x: number, y: number, colorHex: string, diameter: number) => void;

interface PrinterCommandResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export type PrinterReportCallback = (report: any) => void;

interface QueuedCommand {
  gcode: string;
  resolve: (value: PrinterCommandResponse) => void;
  reject: (reason: any) => void;
  timestamp: number;
}

/** Internal position tracker (dead reckoning from homing + our G-code) */
interface TrackedPosition {
  x: number;
  y: number;
  z: number;
  isValid: boolean; // true after successful homing
  lastUpdated: number;
}

class BambuMachineController {
  private telemetry: MachineTelemetry = {
    isConnected: false,
    isSimulated: true,
    connectionMode: 'simulator',
    state: 'idle',
    hotendPos: { x: 0, y: 35, z: 10 },
    penPos: { x: 0, y: 6, z: 10 },
    currentPenIndex: 0,
    currentPen: null,
    currentStrokeIndex: 0,
    totalStrokes: 0,
    progressPercent: 0,
    elapsedSeconds: 0,
    remainingSeconds: 0,
    hotendTemp: 24,
    bedTemp: 23,
    fanSpeed: 0,
    logMessages: ['Bambu Plotter Studio initialized. Ready for calibration or plotting.'],
  };

  /** Dead-reckoned position — valid after G28 homing, updated by our G0/G1 sends */
  private trackedPos: TrackedPosition = { x: 0, y: 35, z: 10, isValid: false, lastUpdated: 0 };

  private listeners: Set<TelemetryCallback> = new Set();
  private strokeListeners: Set<DrawnStrokeCallback> = new Set();
  private dotListeners: Set<DrawnDotCallback> = new Set();
  private reportListeners: Set<PrinterReportCallback> = new Set();

  private activeJob: SlicedPlotJob | null = null;
  private currentPenOffset: PenOffset = { x: 0, y: -29 };
  private currentZCalibration: ZCalibration = createDefaultZCalibration();
  private currentQuality: QualityPreset = 'normal';
  private currentModel: PrinterModel = 'A1_MINI';
  private calibrationListeners: Set<(cal: ZCalibration) => void> = new Set();
  /** True once the printer has reported a real toolhead position this session. */
  private hasLivePosition: boolean = false;

  private animFrameId: number | null = null;
  private timerIntervalId: number | null = null;
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private commandSequenceId: number = 0;
  private isPrinterInitialized: boolean = false;
  
  // Command queue for flow control - all motion commands (G0, G1)
  private commandQueue: QueuedCommand[] = [];
  private isProcessingQueue: boolean = false;
  private lastCriticalCommandTime: number = 0;
  private readonly MIN_CRITICAL_INTERVAL_MS = 10; // Minimum time between homing/Z moves
  private readonly MIN_DRAW_INTERVAL_MS = 2; // Minimum time between drawing moves (G1 X Y)
  private readonly MAX_QUEUE_SIZE = 500; // Increased for drawing move bursts

  constructor() {
    this.updatePenPosition();
    this.startCommandQueueProcessor();
  }

  /**
   * Start the command queue processor for flow control
   */
  private startCommandQueueProcessor(): void {
    // Run continuously without delay
    const process = async () => {
      while (true) {
        await this.processCommandQueue();
        await new Promise(r => setTimeout(r, 1)); // Minimal yield
      }
    };
    process();
  }

  /**
   * Check if a G-code command is a "critical" move that needs flow control
   */
  private isCriticalCommand(gcode: string): boolean {
    const trimmed = gcode.trim().toUpperCase();
    // Critical: ALL motion commands (G0, G1) + homing + pauses + emergency stops
    // This ensures proper flow control for drawing moves to prevent buffer overflow
    return trimmed.startsWith('G28') || 
           trimmed.startsWith('G29') || 
           trimmed.startsWith('M0') || 
           trimmed.startsWith('M112') ||
           trimmed.match(/^G0\b/) !== null ||
           trimmed.match(/^G1\b/) !== null;
  }

  /**
   * Check if a G-code command is a drawing move (G1 X Y without Z)
   */
  private isDrawingMove(gcode: string): boolean {
    const trimmed = gcode.trim().toUpperCase();
    // Drawing move: G1 with X and/or Y but NO Z
    return trimmed.match(/^G1\b/) !== null && 
           (trimmed.includes('X') || trimmed.includes('Y')) && 
           !trimmed.includes('Z');
  }

  /**
   * Process queued commands with rate limiting
   * Drawing moves (G1 X Y) use faster interval; homing/Z moves use slower interval
   */
  private async processCommandQueue(): Promise<void> {
    if (this.isProcessingQueue || this.commandQueue.length === 0) return;
    if (!this.telemetry.isConnected || this.telemetry.connectionMode !== 'mqtt') {
      const error = { success: false, error: 'Printer not connected' };
      this.commandQueue.forEach(cmd => cmd.resolve(error));
      this.commandQueue = [];
      return;
    }

    this.isProcessingQueue = true;
    
    while (this.commandQueue.length > 0) {
      const now = Date.now();
      
      // Determine which interval to use based on the next command
      const nextCmd = this.commandQueue[0];
      const isDraw = this.isDrawingMove(nextCmd.gcode);
      const minInterval = isDraw ? this.MIN_DRAW_INTERVAL_MS : this.MIN_CRITICAL_INTERVAL_MS;
      
      const timeSinceLastCommand = now - this.lastCriticalCommandTime;
      
      if (timeSinceLastCommand < minInterval) {
        await new Promise(r => setTimeout(r, minInterval - timeSinceLastCommand));
        continue;
      }

      const cmd = this.commandQueue.shift()!;
      this.lastCriticalCommandTime = Date.now();

      try {
        const response = await this.sendGcodeDirect(cmd.gcode);
        cmd.resolve(response);
      } catch (err: any) {
        cmd.reject(err);
      }
    }
    
    this.isProcessingQueue = false;
  }

  /**
   * Send G-code directly to printer (bypasses queue)
   */
  private async sendGcodeDirect(gcode: string): Promise<PrinterCommandResponse> {
    try {
      const response = await fetch('/api/bambu/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          gcode, 
          sequence_id: String(++this.commandSequenceId) 
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('[Bambu] Command failed:', response.status, data);
        this.log(`Command failed (${response.status}): ${data.error || JSON.stringify(data)}`);
      }
      
      return data;
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to send G-code to printer';
      this.log(`G-code failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Ensure printer is initialized with G90/G21 before sending motion commands
   * Also disable bed leveling compensation (G29.2 S0) to prevent unwanted probing
   * Bambu printers use G29.2 S0, not M420 S0. Homing re-enables it automatically.
   */
  private async ensurePrinterInitialized(): Promise<void> {
    if (this.isPrinterInitialized) return;
    
    await this.sendGcode('G90'); // Absolute positioning
    await this.sendGcode('G21'); // Millimeters
    await this.sendGcode('G29.2 S0'); // Disable bed leveling compensation (Bambu-specific)
    this.isPrinterInitialized = true;
  }

  /**
   * Reset initialization flag (call on new connection)
   */
  private resetPrinterInitialized(): void {
    this.isPrinterInitialized = false;
  }

  /**
   * Send a command to the real printer via backend API (when in MQTT mode)
   * Falls back to simulator behavior if not connected via MQTT
   */
  private async sendPrinterCommand(command: string, payload?: any): Promise<PrinterCommandResponse> {
    if (this.telemetry.connectionMode !== 'mqtt' || !this.telemetry.isConnected) {
      // Not connected to real printer - simulator mode
      return { success: true, message: 'Simulator mode - command not sent to printer' };
    }

    try {
      const response = await fetch('/api/bambu/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, payload }),
      });

      const data = await response.json();
      return data;
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to send command to printer';
      this.log(`Command failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Send raw G-code to the printer via MQTT
   * Critical commands (homing, Z moves) are queued for flow control
   * Drawing commands (G1 X/Y) are sent directly for speed
   */
  private async sendGcode(gcode: string): Promise<PrinterCommandResponse> {
    if (this.telemetry.connectionMode !== 'mqtt' || !this.telemetry.isConnected) {
      return { success: true, message: 'Simulator mode - command not sent to printer' };
    }

    // HARD SAFETY INTERLOCK: never publish a Z move below the known floor.
    const unsafe = findUnsafeZMove(gcode, getZFloor(this.currentZCalibration));
    if (unsafe) {
      const error = `SAFETY BLOCK: refused Z${unsafe.z.toFixed(3)} (below ${getZFloor(
        this.currentZCalibration
      ).toFixed(2)}mm floor). The toolhead will not be driven into the bed.`;
      this.log(error);
      return { success: false, error };
    }

    // Critical commands go through queue for flow control
    if (this.isCriticalCommand(gcode)) {
      return new Promise((resolve, reject) => {
        if (this.commandQueue.length >= this.MAX_QUEUE_SIZE) {
          reject({ success: false, error: 'Command queue full' });
          return;
        }
        this.commandQueue.push({ gcode, resolve, reject, timestamp: Date.now() });
      });
    }

    // Non-critical (drawing) commands sent directly
    return this.sendGcodeDirect(gcode);
  }

  /**
   * Send a Bambu-specific command (like pushall, homing, etc.)
   */
  private async sendBambuCommand(command: string, params?: any): Promise<PrinterCommandResponse> {
    return this.sendPrinterCommand(command, { ...params, sequence_id: String(++this.commandSequenceId) });
  }

  public subscribe(cb: TelemetryCallback): () => void {
    this.listeners.add(cb);
    cb({ ...this.telemetry });
    return () => this.listeners.delete(cb);
  }

  public onStrokeDrawn(cb: DrawnStrokeCallback): () => void {
    this.strokeListeners.add(cb);
    return () => this.strokeListeners.delete(cb);
  }

  public onDotDrawn(cb: DrawnDotCallback): () => void {
    this.dotListeners.add(cb);
    return () => this.dotListeners.delete(cb);
  }

  public onPrinterReport(cb: PrinterReportCallback): () => void {
    this.reportListeners.add(cb);
    return () => this.reportListeners.delete(cb);
  }

  private notify() {
    const copy = { ...this.telemetry };
    this.listeners.forEach((cb) => cb(copy));
  }

  private notifyReport(report: any) {
    this.reportListeners.forEach((cb) => cb(report));
  }

  private log(msg: string) {
    const timestamp = new Date().toLocaleTimeString();
    this.telemetry.logMessages = [
      `[${timestamp}] ${msg}`,
      ...this.telemetry.logMessages.slice(0, 49),
    ];
    this.notify();
  }

  public setConfig(
    model: PrinterModel,
    offset: PenOffset,
    zCal: ZCalibration,
    quality: QualityPreset
  ) {
    this.currentModel = model;
    this.currentPenOffset = offset;
    this.currentZCalibration = normalizeZCalibration(zCal, model);
    this.currentQuality = quality;
    this.updatePenPosition();
  }

  /** Subscribe to Z calibration changes made inside the controller. */
  public onZCalibrationChanged(cb: (cal: ZCalibration) => void): () => void {
    this.calibrationListeners.add(cb);
    return () => this.calibrationListeners.delete(cb);
  }

  private emitZCalibration(cal: ZCalibration) {
    this.currentZCalibration = normalizeZCalibration(cal, this.currentModel);
    const copy = { ...this.currentZCalibration };
    this.calibrationListeners.forEach((cb) => cb(copy));
    this.updatePenPosition();
  }

  public getZCalibration(): ZCalibration {
    return { ...this.currentZCalibration };
  }

  public getZFloor(): number {
    return getZFloor(this.currentZCalibration);
  }

  public isZReady(): boolean {
    return isZSafeToPlot(this.currentZCalibration);
  }

  public getZBlockReason(): string | null {
    return getZBlockReason(this.currentZCalibration);
  }

  public hasKnownPosition(): boolean {
    return this.hasLivePosition || this.telemetry.connectionMode === 'simulator';
  }

  /**
   * Send a raw G-code command directly to the printer (bypasses queue).
   * Used for manual commands like position refresh.
   */
  public async sendRawGcode(gcode: string): Promise<PrinterCommandResponse> {
    if (this.telemetry.connectionMode !== 'mqtt' || !this.telemetry.isConnected) {
      return { success: false, error: 'Printer not connected via MQTT' };
    }
    await this.ensurePrinterInitialized();
    return this.sendGcodeDirect(gcode);
  }

  /**
   * Capture the physical bed reference.
   *
   * The operator homes the printer and jogs Z down until the firmware stops the
   * toolhead at the bed. Pressing capture stores that exact machine Z without
   * moving the toolhead. The drawing plane then becomes `bed + 1 mm` and is
   * locked — it is no longer operator-editable.
   */
  public captureBedReference(): { success: boolean; calibration?: ZCalibration; error?: string } {
    // Determine Z to capture:
    // 1. Prefer trackedPos (dead reckoning from homing + our G-code) if valid
    // 2. Fall back to telemetry.hotendPos.z (may be stale or missing Z)
    let rawZ: number;
    if (this.trackedPos.isValid && Number.isFinite(this.trackedPos.z)) {
      rawZ = this.trackedPos.z;
      this.log(`Capture using tracked position: Z${rawZ.toFixed(3)}mm`);
    } else if (this.telemetry.connectionMode === 'mqtt' && !this.hasLivePosition) {
      return {
        success: false,
        error:
          'No live Z position available. Home the printer first, then capture.',
      };
    } else {
      rawZ = this.telemetry.hotendPos.z;
      if (!Number.isFinite(rawZ)) {
        return { success: false, error: 'No valid Z position available.' };
      }
      this.log(`Capture using telemetry: Z${rawZ.toFixed(3)}mm`);
    }

    const bedReferenceZ = Math.max(Z_SAFETY.ABSOLUTE_MIN_Z_MM, rawZ);

    const next = normalizeZCalibration(
      {
        ...this.currentZCalibration,
        bedReferenceZ,
        isCalibrated: true,
        datumSource: 'bed_stop',
        datumCapturedAt: new Date().toISOString(),
      },
      this.currentModel
    );

    this.emitZCalibration(next);
    this.log(
      `Bed reference captured at ${bedReferenceZ.toFixed(
        2
      )}mm. Drawing plane locked to ${getDrawZ(next).toFixed(2)}mm (bed + ${Z_SAFETY.BED_CLEARANCE_MM.toFixed(
        1
      )}mm). Install the pen so its tip just touches the paper at this height.`
    );

    return { success: true, calibration: { ...this.currentZCalibration } };
  }

  /**
   * Fine-adjust Z by a tiny amount (0.05mm).
   * Used during calibration to nudge the bed reference up/down slightly.
   * Updates trackedPos internally since MQTT doesn't report position.
   */
  public async fineAdjustZ(deltaMm: number): Promise<{ success: boolean; error?: string }> {
    if (this.telemetry.connectionMode !== 'mqtt' || !this.telemetry.isConnected) {
      // Simulator mode
      this.trackedPos.z = Math.max(0, this.trackedPos.z + deltaMm);
      this.trackedPos.lastUpdated = Date.now();
      this.telemetry.hotendPos.z = this.trackedPos.z;
      this.updatePenPosition();
      this.notify();
      return { success: true };
    }

    if (!this.trackedPos.isValid) {
      return { success: false, error: 'Position not known. Home the printer first.' };
    }

    // Ensure printer is initialized (G90, G21, G29.2 S0) and clear any Z-trim
    await this.ensurePrinterInitialized();
    await this.sendGcode('G29.1 Z0'); // Clear Z-trim offset

    const newZ = Math.max(0, this.trackedPos.z + deltaMm);
    const gcode = `G0 Z${newZ.toFixed(3)} F600`;
    const result = await this.sendGcodeDirect(gcode);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Update tracked position immediately (dead reckoning)
    this.trackedPos.z = newZ;
    this.trackedPos.lastUpdated = Date.now();
    this.telemetry.hotendPos.z = newZ;
    this.updatePenPosition();
    this.notify();
    this.log(`Fine Z adjust: ${deltaMm > 0 ? '+' : ''}${deltaMm.toFixed(3)}mm → Z${newZ.toFixed(3)}mm`);
    return { success: true };
  }

  /** Change the pen release / travel lift (1–3 mm) above the fixed draw plane. */
  public setPenRelease(mm: number) {
    this.emitZCalibration(
      normalizeZCalibration(
        { ...this.currentZCalibration, penReleaseMm: clampPenRelease(mm) },
        this.currentModel
      )
    );
  }

  public connectSimulator() {
    this.telemetry.connectionMode = 'simulator';
    this.telemetry.isSimulated = true;
    this.telemetry.isConnected = true;
    this.telemetry.connectionError = undefined;
    this.log('Connected to Bambu Virtual Precision Plotter Engine (Simulation Mode).');
    this.notify();
  }

  public connectMqtt(ip: string, serial: string) {
    this.telemetry.connectionMode = 'mqtt';
    this.telemetry.isSimulated = false;
    this.telemetry.isConnected = true;
    this.telemetry.connectedIp = ip;
    this.telemetry.connectedSerial = serial;
    this.telemetry.connectionError = undefined;
    this.hasLivePosition = false;
    this.resetPrinterInitialized(); // Reset init flag on new connection
    this.log(`Authentication verified: Connected to Bambu A1 LAN Broker at ${ip}:8883 (${serial}).`);
    this.log('Z datum must be established this session: capture the pen-contact height or run a bed probe.');
    this.notify();
  }

  public setConnectionError(error: string) {
    this.telemetry.isConnected = false;
    this.telemetry.connectionError = error;
    this.log(`Bambu Connection Failed: ${error}`);
    this.notify();
  }

  public disconnect(reason = 'Disconnected by user') {
    this.telemetry.isConnected = false;
    this.telemetry.connectedIp = undefined;
    this.telemetry.connectedSerial = undefined;
    this.telemetry.connectionError = undefined;
    this.hasLivePosition = false;
    this.resetPrinterInitialized(); // Reset init flag on disconnect
    this.stopPrinterEventStream();
    this.log(`Bambu Link: ${reason}`);
    this.notify();
  }

  private eventSource: EventSource | null = null;

  public setConnectionMode(mode: 'simulator' | 'mqtt', ip?: string, serial?: string) {
    if (mode === 'simulator') {
      this.connectSimulator();
      this.stopPrinterEventStream();
    } else if (ip && serial) {
      this.connectMqtt(ip, serial);
      this.startPrinterEventStream();
    } else {
      this.telemetry.connectionMode = 'mqtt';
      this.telemetry.isSimulated = false;
      this.telemetry.isConnected = false;
      this.stopPrinterEventStream();
      this.notify();
    }
  }

  private startPrinterEventStream(): void {
    if (this.eventSource) return;
    
    this.eventSource = new EventSource('/api/bambu/events');
    
    this.eventSource.onmessage = (event) => {
      try {
        const report = JSON.parse(event.data);
        this.handlePrinterReport(report);
      } catch (_) {}
    };
    
    this.eventSource.onerror = () => {
      console.warn('[Bambu] SSE connection error, will retry...');
      this.eventSource?.close();
      this.eventSource = null;
      setTimeout(() => this.startPrinterEventStream(), 5000);
    };
  }

  private stopPrinterEventStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private handlePrinterReport(report: any): void {
    // Update local telemetry with actual printer position
    if (report.print && typeof report.print === 'object') {
      const p = report.print;
      
      // Update hotend position from printer report
      // Bambu sometimes omits Z or sends it as string; parse defensively
      // Also check alternative locations: p.pos, p.coord, etc.
      const parseCoord = (v: any): number | null => {
        if (typeof v === 'number') return v;
        if (typeof v === 'string') {
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };
      
      // Try multiple possible locations for position data
      let x = parseCoord(p.x);
      let y = parseCoord(p.y);
      let z = parseCoord(p.z);
      
      if (x === null && p.pos) x = parseCoord(p.pos.x);
      if (y === null && p.pos) y = parseCoord(p.pos.y);
      if (z === null && p.pos) z = parseCoord(p.pos.z);
      
      if (x === null && p.coord) x = parseCoord(p.coord.x);
      if (y === null && p.coord) y = parseCoord(p.coord.y);
      if (z === null && p.coord) z = parseCoord(p.coord.z);
      
      if (x !== null && y !== null) {
        // Z may be missing; if so, keep last known Z
        const newZ = z !== null ? z : this.telemetry.hotendPos.z;
        this.telemetry.hotendPos = { x, y, z: newZ };
        this.trackedPos = { x, y, z: newZ, isValid: true, lastUpdated: Date.now() };
        this.hasLivePosition = true;
        this.updatePenPosition();
        if (z !== null) {
          this.log(`Position update: X${x.toFixed(2)} Y${y.toFixed(2)} Z${z.toFixed(2)}`);
        } else {
          this.log(`Position update (no Z): X${x.toFixed(2)} Y${y.toFixed(2)} — using last Z`);
        }
      }
      
      // Parse M114 position responses from mc_print push_info
      if (report.mc_print && typeof report.mc_print === 'object') {
        const mc = report.mc_print;
        if (mc.command === 'push_info' && typeof mc.param === 'string') {
          const param = mc.param.trim();
          // M114 response typically looks like: "X:10.0 Y:20.0 Z:5.0 E:0.0 Count X:... Y:... Z:..."
          // Or: "ok X:10.0 Y:20.0 Z:5.0 E:0.0"
          const m114Match = param.match(/X:?\s*(-?\d+\.?\d*)\s+Y:?\s*(-?\d+\.?\d*)\s+Z:?\s*(-?\d+\.?\d*)/);
          if (m114Match) {
            const mx = parseFloat(m114Match[1]);
            const my = parseFloat(m114Match[2]);
            const mz = parseFloat(m114Match[3]);
            if (Number.isFinite(mx) && Number.isFinite(my) && Number.isFinite(mz)) {
              this.telemetry.hotendPos = { x: mx, y: my, z: mz };
              this.trackedPos = { x: mx, y: my, z: mz, isValid: true, lastUpdated: Date.now() };
              this.hasLivePosition = true;
              this.updatePenPosition();
              this.log(`M114 position: X${mx.toFixed(2)} Y${my.toFixed(2)} Z${mz.toFixed(2)}`);
            }
          }
        }
      }
      
      // Update other telemetry
      if (typeof p.nozzle_temp === 'number') this.telemetry.hotendTemp = p.nozzle_temp;
      if (typeof p.bed_temp === 'number') this.telemetry.bedTemp = p.bed_temp;
      if (typeof p.fan_speed === 'number') this.telemetry.fanSpeed = p.fan_speed;
      if (typeof p.gcode_state === 'string') {
        const stateMap: Record<string, MachineExecutionState> = {
          'IDLE': 'idle',
          'RUNNING': 'plotting',
          'PAUSE': 'paused',
          'FINISH': 'completed',
          'FAILED': 'error',
        };
        this.telemetry.state = stateMap[p.gcode_state] || this.telemetry.state;
      }
    }
    
    this.notifyReport(report);
    this.notify();
  }

  public async verifyAndConnectMqtt(
    ip: string,
    serial: string,
    accessCode: string,
    port?: number,
    username?: string,
    isBridge?: boolean
  ): Promise<{ success: boolean; message: string }> {
    try {
      const response = await fetch('/api/bambu/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip,
          serialNumber: serial,
          accessCode,
          port,
          username,
          isBridge,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const errorMsg = data.error || 'Failed to authenticate with Bambu printer';
        this.setConnectionError(errorMsg);
        throw new Error(errorMsg);
      }

      this.connectMqtt(ip, serial);
      return { success: true, message: data.message };
    } catch (err: any) {
      const errorMsg = err.message || 'Network error verifying Bambu credentials';
      this.setConnectionError(errorMsg);
      throw err;
    }
  }

  private updatePenPosition() {
    this.telemetry.penPos = {
      x: this.telemetry.hotendPos.x + this.currentPenOffset.x,
      y: this.telemetry.hotendPos.y + this.currentPenOffset.y,
      z: this.telemetry.hotendPos.z - getDrawZ(this.currentZCalibration),
    };
    this.notify();
  }

  // Jog Controls
  public async jog(axis: 'x' | 'y' | 'z', delta: number) {
    const spec = PRINTER_SPECS[this.currentModel];
    const newPos = { ...this.telemetry.hotendPos };
    const floor = getZFloor(this.currentZCalibration);

    if (axis === 'x') {
      newPos.x = Math.max(0, Math.min(spec.width, newPos.x + delta));
    } else if (axis === 'y') {
      newPos.y = Math.max(0, Math.min(spec.depth, newPos.y + delta));
    } else if (axis === 'z') {
      const requested = newPos.z + delta;
      newPos.z = Math.max(floor, Math.min(spec.height, requested));
      if (requested < floor - Z_SAFETY.EPSILON_MM) {
        this.log(
          `SAFETY: Z jog limited to the ${floor.toFixed(2)}mm floor. Clearance below this is blocked.`
        );
      }
    }

    // Send real command if connected to printer
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.ensurePrinterInitialized();
      const feedrate = axis === 'z' ? 600 : 3000; // Z moves slower
      const gcode = `G0 ${axis.toUpperCase()}${newPos[axis].toFixed(3)} F${feedrate}`;
      const result = await this.sendGcodeAndWait(gcode, 
        axis === 'x' ? newPos.x : undefined,
        axis === 'y' ? newPos.y : undefined,
        axis === 'z' ? newPos.z : undefined,
        false // Don't wait for position on jog
      );
      if (!result.success) {
        this.log(`Jog failed: ${result.error}`);
        return;
      }
    }

    this.telemetry.hotendPos = newPos;
    // Update tracked position (dead reckoning)
    this.trackedPos = { ...newPos, isValid: this.trackedPos.isValid, lastUpdated: Date.now() };
    this.updatePenPosition();
    this.log(`Jog ${axis.toUpperCase()} by ${delta > 0 ? '+' : ''}${delta.toFixed(1)}mm -> Hotend (${newPos.x.toFixed(1)}, ${newPos.y.toFixed(1)}, ${newPos.z.toFixed(1)})`);
  }

  public async moveTo(x: number, y: number, z?: number) {
    const spec = PRINTER_SPECS[this.currentModel];
    const floor = getZFloor(this.currentZCalibration);
    const newPos = {
      x: Math.max(0, Math.min(spec.width, x)),
      y: Math.max(0, Math.min(spec.depth, y)),
      z: z !== undefined ? Math.max(floor, Math.min(spec.height, z)) : this.telemetry.hotendPos.z,
    };

    // Send real command if connected to printer
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.ensurePrinterInitialized();
      const gcodeParts = [`G0 X${newPos.x.toFixed(3)} Y${newPos.y.toFixed(3)}`];
      if (z !== undefined) {
        gcodeParts.push(`Z${newPos.z.toFixed(3)}`);
      }
      gcodeParts.push('F3000');
      const gcode = gcodeParts.join(' ');
      const result = await this.sendGcodeAndWait(gcode, newPos.x, newPos.y, newPos.z, false);
      if (!result.success) {
        this.log(`Move failed: ${result.error}`);
        return;
      }
    }

    this.telemetry.hotendPos = newPos;
    // Update tracked position (dead reckoning)
    this.trackedPos = { ...newPos, isValid: this.trackedPos.isValid, lastUpdated: Date.now() };
    this.updatePenPosition();
  }

  public async homeAll() {
    this.telemetry.state = 'homing';
    this.log('G28: Homing all axes. Remove the pen first — the nozzle will touch the bed.');
    this.notify();

    // Send real command if connected to printer
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      const result = await this.sendGcodeAndWait('G28', 0, 0, 0, true); // Wait for homing
      if (!result.success) {
        this.log(`Homing failed: ${result.error}`);
        this.telemetry.state = 'idle';
        this.notify();
        return;
      }
      this.telemetry.hotendPos = { x: 0, y: 0, z: 0 };
      this.trackedPos = { x: 0, y: 0, z: 0, isValid: true, lastUpdated: Date.now() };
      this.hasLivePosition = true;
      // Ensure bed leveling compensation stays disabled after homing (Bambu: G29.2 S0)
      await this.sendGcode('G29.2 S0');
    } else {
      // Simulator fallback / UI update
      await new Promise((r) => setTimeout(r, 1200));
      this.telemetry.hotendPos = { x: 0, y: 0, z: 0 };
      this.trackedPos = { x: 0, y: 0, z: 0, isValid: true, lastUpdated: Date.now() };
    }

    // Homing resets the coordinate system, so any previous bed reference is
    // no longer trustworthy. Ask the operator to capture it again.
    this.emitZCalibration(
      normalizeZCalibration(
        {
          ...this.currentZCalibration,
          bedReferenceZ: Z_SAFETY.ABSOLUTE_MIN_Z_MM,
          isCalibrated: false,
          datumSource: 'none',
          datumCapturedAt: null,
        },
        this.currentModel
      )
    );

    this.telemetry.state = 'idle';
    this.log(
      'Homing complete. The nozzle is now at the bed (Z=0). Press "Capture Bed Reference" to lock bed at Z=0, or use "Fine Adjust Z" to nudge slightly first.'
    );
    this.updatePenPosition();
    this.notify();
  }

  public async homeZ() {
    this.telemetry.state = 'homing';
    this.log('G28 Z: Homing Z axis. Remove the pen first — the nozzle will touch the bed.');
    this.notify();

    // Send real command if connected to printer
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      const result = await this.sendGcodeAndWait('G28 Z', undefined, undefined, 0, true); // Wait for Z homing
      if (!result.success) {
        this.log(`Z-Homing failed: ${result.error}`);
        this.telemetry.state = 'idle';
        this.notify();
        return;
      }
      this.telemetry.hotendPos.z = 0;
      this.trackedPos.z = 0;
      this.trackedPos.isValid = true;
      this.trackedPos.lastUpdated = Date.now();
      this.hasLivePosition = true;
    } else {
      // Simulator fallback / UI update
      await new Promise((r) => setTimeout(r, 800));
      this.telemetry.hotendPos.z = 0;
      this.trackedPos.z = 0;
      this.trackedPos.isValid = true;
      this.trackedPos.lastUpdated = Date.now();
    }
    // Ensure bed leveling compensation stays disabled after homing (Bambu: G29.2 S0)
    await this.sendGcode('G29.2 S0');

    this.emitZCalibration(
      normalizeZCalibration(
        {
          ...this.currentZCalibration,
          bedReferenceZ: Z_SAFETY.ABSOLUTE_MIN_Z_MM,
          isCalibrated: false,
          datumSource: 'none',
          datumCapturedAt: null,
        },
        this.currentModel
      )
    );

    this.telemetry.state = 'idle';
    this.log(
      'Z homed to the bed (Z=0). Press "Capture Bed Reference" to lock bed at Z=0, or use "Fine Adjust Z" to nudge slightly first.'
    );
    this.updatePenPosition();
    this.notify();
  }

  public async startPlot(job: SlicedPlotJob) {
    if (this.isRunning) return;

    // HARD PRE-FLIGHT: a plot may only start from a captured bed reference.
    const blockReason = getZBlockReason(this.currentZCalibration);
    if (blockReason) {
      this.telemetry.state = 'error';
      this.log(`SAFETY BLOCK: ${blockReason}`);
      this.notify();
      return;
    }

    if (
      this.telemetry.connectionMode === 'mqtt' &&
      this.telemetry.isConnected &&
      !this.hasLivePosition
    ) {
      this.telemetry.state = 'error';
      this.log(
        'SAFETY BLOCK: no live printer position yet. Wait for telemetry before starting a plot.'
      );
      this.notify();
      return;
    }

    this.activeJob = job;
    this.isRunning = true;
    this.isPaused = false;
    this.telemetry.state = 'plotting';
    this.telemetry.elapsedSeconds = 0;
    this.telemetry.remainingSeconds = job.estimatedSeconds;
    this.telemetry.currentStrokeIndex = 0;
    this.telemetry.totalStrokes = job.layersByPen.reduce(
      (acc, l) => acc + l.strokeSegments.length,
      0
    );
    this.telemetry.progressPercent = 0;
    this.log(
      `Plot started: ${job.layersByPen.length} pen layers, ${this.telemetry.totalStrokes} total paths. Z floor ${getZFloor(
        this.currentZCalibration
      ).toFixed(2)}mm, draw plane ${getDrawZ(this.currentZCalibration).toFixed(2)}mm.`
    );

    // Start elapsed timer
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => {
      if (this.isRunning && !this.isPaused && this.telemetry.state === 'plotting') {
        this.telemetry.elapsedSeconds += 1;
        this.telemetry.remainingSeconds = Math.max(0, this.telemetry.remainingSeconds - 1);
        this.notify();
      }
    }, 1000);

    // Execute layers sequentially
    this.executeLayerSequence(0);
  }

  private async executeLayerSequence(layerIndex: number) {
    if (!this.isRunning || !this.activeJob) return;

    if (layerIndex >= this.activeJob.layersByPen.length) {
      this.finishPlot();
      return;
    }

    const layer = this.activeJob.layersByPen[layerIndex];
    this.telemetry.currentPenIndex = layerIndex;
    this.telemetry.currentPen = layer.pen;

    // Check if color change is needed (multi-color mode)
    if (this.activeJob.layersByPen.length > 1) {
      this.log(
        `Color swap required: Layer ${layerIndex + 1}/${this.activeJob.layersByPen.length} -> ${layer.pen.name} (${layer.pen.hex})`
      );
      this.telemetry.state = 'waiting_pen_change';
      this.telemetry.pendingColorChange = {
        nextPen: layer.pen,
        penIndex: layerIndex,
        totalPens: this.activeJob.layersByPen.length,
      };

      // Lift Z and park toolhead at front service position.
      // NO homing here: re-homing drives the nozzle into the bed and would
      // dislodge the loosely seated pen. The software datum is preserved, so
      // every pen is seated against the same draw plane.
      const spec = PRINTER_SPECS[this.currentModel];
      const travelZ = getTravelZ(this.currentZCalibration);
      const drawZ = getDrawZ(this.currentZCalibration);
      const parkX = Math.round(spec.width / 2);
      const parkY = 15;

      if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
        await this.sendGcodeAndWait(
          `G0 Z${travelZ.toFixed(3)} F${QUALITY_PRESETS[this.currentQuality].zLiftFeedrate}`,
          undefined,
          undefined,
          travelZ,
          false
        );
        await this.sendGcodeAndWait(
          `G0 X${parkX} Y${parkY} F${QUALITY_PRESETS[this.currentQuality].travelFeedrate}`,
          parkX,
          parkY,
          undefined,
          false
        );
        // Descend to the exact draw plane so the operator can seat the pen
        // against the paper at the same height every layer. No homing.
        await this.sendGcodeAndWait(
          `G0 Z${drawZ.toFixed(3)} F${QUALITY_PRESETS[this.currentQuality].zLiftFeedrate}`,
          undefined,
          undefined,
          drawZ,
          false
        );
      }

      this.telemetry.hotendPos = { x: parkX, y: parkY, z: drawZ };
      this.updatePenPosition();

      this.log(
        'Pen change: parked at the draw plane for accurate seating. Z datum is kept in software — no re-homing, no bed contact.'
      );

      this.notify();
      return; // Execution pauses here until resumePlotAfterColorSwap is called
    }

    // Single layer or current layer execution
    await this.plotLayerStrokes(layerIndex);
  }

  public async resumePlotAfterColorSwap() {
    if (!this.isRunning || !this.activeJob || this.telemetry.state !== 'waiting_pen_change') return;

    const currentLayerIdx = this.telemetry.currentPenIndex;
    const pen = this.telemetry.currentPen;

    this.log(`Pen confirmed: [${pen?.name}]. Height seated against paper datum. Resuming drawing...`);
    this.telemetry.pendingColorChange = undefined;
    this.telemetry.state = 'plotting';
    this.notify();

    await this.plotLayerStrokes(currentLayerIdx);
  }

  private async plotLayerStrokes(layerIndex: number) {
    if (!this.isRunning || !this.activeJob) return;

    const layer = this.activeJob.layersByPen[layerIndex];
    const qSettings = QUALITY_PRESETS[this.currentQuality];
    const speedMultiplier = (qSettings.drawFeedrate / 3000) * 1.5;

    // If connected to real printer, send G-code for the entire layer
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.sendPlotLayerGcode(layer, layerIndex);
      // Still update UI for visualization
      await this.simulatePlotLayer(layer, layerIndex, speedMultiplier);
    } else {
      // Simulator only mode
      await this.simulatePlotLayer(layer, layerIndex, speedMultiplier);
    }

    // Advance to next layer
    this.executeLayerSequence(layerIndex + 1);
  }

  /**
   * Send G-code commands for a plot layer to the real printer
   */
  private async sendPlotLayerGcode(layer: any, layerIndex: number): Promise<void> {
    const travelFeedrate = QUALITY_PRESETS[this.currentQuality].travelFeedrate;
    const drawFeedrate = QUALITY_PRESETS[this.currentQuality].drawFeedrate;
    // Absolute planes derived from the safety model:
    //   draw   = captured/known drawing plane (>= floor, >= 1mm above bed)
    //   travel = draw + relative lift
    const drawZ = getDrawZ(this.currentZCalibration);
    const travelZ = getTravelZ(this.currentZCalibration);
    const accel = QUALITY_PRESETS[this.currentQuality].acceleration;

    // Initialize printer for plotting (only on first layer)
    if (layerIndex === 0) {
      await this.initializePrinterForPlotting(travelFeedrate, drawFeedrate, accel);
    }

    for (const segment of layer.strokeSegments) {
      if (!this.isRunning) return;

      if (segment.points.length === 0) continue;

      const p0 = segment.points[0];

      // Rapid move to start position (pen up)
      const startX = p0.x - this.currentPenOffset.x;
      const startY = p0.y - this.currentPenOffset.y;
      await this.sendGcodeAndWait(
        `G0 X${startX.toFixed(3)} Y${startY.toFixed(3)} Z${travelZ.toFixed(3)} F${travelFeedrate}`,
        startX, startY, travelZ,
        false // Don't wait for position - rely on command queue flow control
      );

      if (segment.isPeck) {
        // Stipple dot - plunge down and up
        await this.sendGcodeAndWait(`G0 Z${drawZ.toFixed(3)} F${drawFeedrate}`, undefined, undefined, drawZ, false);
        await this.sendGcodeAndWait(`G0 Z${travelZ.toFixed(3)} F${travelFeedrate}`, undefined, undefined, travelZ, false);
      } else {
        // Pen down for drawing
        await this.sendGcodeAndWait(`G0 Z${drawZ.toFixed(3)} F${drawFeedrate}`, undefined, undefined, drawZ, false);

        // Draw each segment point - queue handles flow control
        for (let ptIdx = 1; ptIdx < segment.points.length; ptIdx++) {
          if (!this.isRunning) return;
          const pt = segment.points[ptIdx];
          const x = pt.x - this.currentPenOffset.x;
          const y = pt.y - this.currentPenOffset.y;
          
          const effectivePreset: QualityPreset = segment.qualityPreset || this.currentQuality;
          const effectiveFeedrate = QUALITY_PRESETS[effectivePreset]?.drawFeedrate || drawFeedrate;
          
          await this.sendGcode(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${effectiveFeedrate}`);
        }

        // Lift pen
        await this.sendGcodeAndWait(`G0 Z${travelZ.toFixed(3)} F${travelFeedrate}`, undefined, undefined, travelZ, false);
      }
    }
  }

  /**
   * Initialize printer for plotting.
   *
   * Deliberately does NOT home. Homing is the printer's own procedure and drives
   * the nozzle into the bed, which dislodges a loosely seated pen. The drawing
   * plane is established once by the operator (capture / bed probe) and stored
   * in the safety model instead.
   */
  private async initializePrinterForPlotting(travelFeedrate: number, drawFeedrate: number, accel: number): Promise<void> {
    // Set absolute positioning and mm units
    await this.sendGcode('G90'); // Absolute positioning
    await this.sendGcode('G21'); // Millimeters
    await this.sendGcode('G29.2 S0'); // Disable bed leveling compensation (Bambu-specific)

    // Set acceleration
    await this.sendGcode(`M204 T${accel} P${accel}`); // Travel and print acceleration

    // Raise to the relative travel plane before any XY motion
    const travelZ = getTravelZ(this.currentZCalibration);
    await this.sendGcodeAndWait(
      `G0 Z${travelZ.toFixed(3)} F${travelFeedrate}`,
      undefined,
      undefined,
      travelZ,
      false
    );

    this.log(
      `Printer initialized for plotting: G90 G21 M204 (no homing). Travel plane ${travelZ.toFixed(
        2
      )}mm, draw plane ${getDrawZ(this.currentZCalibration).toFixed(2)}mm, floor ${getZFloor(
        this.currentZCalibration
      ).toFixed(2)}mm.`
    );
  }

  /**
   * Wait for printer to reach target position (with timeout)
   * Only used for homing - Z moves during drawing don't wait
   */
  private async waitForPosition(targetX: number, targetY: number, targetZ: number, tolerance: number = 2.0, timeoutMs: number = 5000): Promise<boolean> {
    if (this.telemetry.connectionMode !== 'mqtt' || !this.telemetry.isConnected) {
      return true; // Simulator mode
    }

    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const checkPosition = () => {
        if (!this.isRunning) {
          resolve(false);
          return;
        }

        const pos = this.telemetry.hotendPos;
        const dx = Math.abs(pos.x - targetX);
        const dy = Math.abs(pos.y - targetY);
        const dz = Math.abs(pos.z - targetZ);
        
        if (dx <= tolerance && dy <= tolerance && dz <= tolerance) {
          resolve(true);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          this.log(`Position timeout (${timeoutMs}ms): target (${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)}) actual (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
          resolve(true); // Continue anyway - don't block
        }

        setTimeout(checkPosition, 50);
      };
      checkPosition();
    });
  }

  /**
   * Send G-code and wait for printer to reach target position (only for homing)
   * For drawing moves, don't wait - just send and continue
   */
  private async sendGcodeAndWait(gcode: string, targetX?: number, targetY?: number, targetZ?: number, waitForPosition: boolean = false): Promise<PrinterCommandResponse> {
    const result = await this.sendGcode(gcode);
    if (!result.success) return result;

    // Only wait for position if explicitly requested (e.g., for G28 homing)
    if (waitForPosition && (targetX !== undefined || targetY !== undefined || targetZ !== undefined)) {
      const currentPos = this.telemetry.hotendPos;
      const tx = targetX ?? currentPos.x;
      const ty = targetY ?? currentPos.y;
      const tz = targetZ ?? currentPos.z;
      
      await this.waitForPosition(tx, ty, tz, 2.0);
    }

    return result;
  }

  /**
   * Simulate plot layer for UI visualization (runs in parallel with real printing)
   */
  private async simulatePlotLayer(layer: any, layerIndex: number, speedMultiplier: number): Promise<void> {
    const qSettings = QUALITY_PRESETS[this.currentQuality];
    const travelLiftZ = getTravelZ(this.currentZCalibration);
    const drawZ = getDrawZ(this.currentZCalibration);

    for (let sIdx = 0; sIdx < layer.strokeSegments.length; sIdx++) {
      if (!this.isRunning) return;

      while (this.isPaused) {
        await new Promise((r) => setTimeout(r, 100));
        if (!this.isRunning) return;
      }

      const segment = layer.strokeSegments[sIdx];
      if (segment.points.length === 0) continue;

      // Rapid move to start (pen up)
      const p0 = segment.points[0];
      this.telemetry.hotendPos = {
        x: p0.x - this.currentPenOffset.x,
        y: p0.y - this.currentPenOffset.y,
        z: travelLiftZ,
      };
      this.updatePenPosition();

      if (segment.isPeck) {
        // Stipple dot plunge
        this.telemetry.hotendPos.z = drawZ;
        this.updatePenPosition();

        this.dotListeners.forEach((cb) =>
          cb(p0.x, p0.y, layer.pen.hex, layer.pen.diameter)
        );

        await new Promise((r) => setTimeout(r, Math.max(15, 60 / speedMultiplier)));

        this.telemetry.hotendPos.z = travelLiftZ;
        this.updatePenPosition();
      } else {
        // Pen down
        this.telemetry.hotendPos.z = drawZ;
        this.updatePenPosition();

        // Draw points along the polyline
        let prevPt = p0;
        for (let ptIdx = 1; ptIdx < segment.points.length; ptIdx++) {
          if (!this.isRunning) return;
          const pt = segment.points[ptIdx];

          const dist = Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y);
          const effectivePreset: QualityPreset = segment.qualityPreset || this.currentQuality;
          const effectiveFeedrate = QUALITY_PRESETS[effectivePreset]?.drawFeedrate || qSettings.drawFeedrate;
          const stepTimeMs = Math.max(8, Math.min(200, (dist / (effectiveFeedrate / 60000))));

          await new Promise((r) => setTimeout(r, stepTimeMs / speedMultiplier));

          this.telemetry.hotendPos = {
            x: pt.x - this.currentPenOffset.x,
            y: pt.y - this.currentPenOffset.y,
            z: drawZ,
          };
          this.updatePenPosition();

          const curPrev = prevPt;
          this.strokeListeners.forEach((cb) =>
            cb(curPrev.x, curPrev.y, pt.x, pt.y, layer.pen.hex, layer.pen.diameter)
          );

          prevPt = pt;
        }

        // Lift pen
        this.telemetry.hotendPos.z = travelLiftZ;
        this.updatePenPosition();
      }

      this.telemetry.currentStrokeIndex++;
      this.telemetry.progressPercent = Math.min(
        100,
        Math.round((this.telemetry.currentStrokeIndex / Math.max(1, this.telemetry.totalStrokes)) * 100)
      );
      this.notify();
    }
  }

  public async pausePlot() {
    if (!this.isRunning) return;
    this.isPaused = true;
    this.telemetry.state = 'paused';
    // Lift pen to avoid bleeding ink (relative to the draw plane, never below floor)
    const safeLiftZ = Math.min(
      PRINTER_SPECS[this.currentModel].height,
      getTravelZ(this.currentZCalibration) + 5
    );
    this.telemetry.hotendPos.z = safeLiftZ;
    this.updatePenPosition();

    // Clear command queue
    this.clearCommandQueue();

    // Send pause command to real printer (emergency stop / pause)
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.sendGcodeAndWait(`G0 Z${safeLiftZ.toFixed(3)} F3000`);
      await this.sendGcodeAndWait('M0'); // Emergency stop / pause
    }

    this.log('Plot paused. Pen lifted from paper.');
    this.notify();
  }

  private clearCommandQueue(): void {
    const error = { success: false, error: 'Operation cancelled' };
    this.commandQueue.forEach(cmd => cmd.resolve(error));
    this.commandQueue = [];
  }

  public async resumePlot() {
    if (!this.isRunning || !this.isPaused) return;
    this.isPaused = false;
    this.telemetry.state = 'plotting';
    
    // Send resume command to real printer
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      // Bambu printers may not support M0 resume, so we just continue sending G-code
      this.log('Plot resumed - continuing G-code stream...');
    } else {
      this.log('Plot resumed.');
    }
    this.notify();
  }

  public async abortPlot() {
    this.isRunning = false;
    this.isPaused = false;
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.telemetry.state = 'aborted';
    // Lift pen
    this.telemetry.hotendPos.z = 25;
    this.updatePenPosition();
    
    // Clear command queue
    this.clearCommandQueue();
    
    // Send emergency stop to real printer
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.sendGcodeAndWait('M112'); // Emergency stop
      const safeLiftZ = Math.min(
        PRINTER_SPECS[this.currentModel].height,
        Math.max(25, getTravelZ(this.currentZCalibration))
      );
      await this.sendGcodeAndWait(`G0 Z${safeLiftZ.toFixed(3)} F3000`); // Retract pen above the draw plane
    }
    
    this.log('Emergency Stop triggered: Plot aborted. Pen retracted safely.');
    this.notify();
  }

  private finishPlot() {
    this.isRunning = false;
    this.isPaused = false;
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.telemetry.state = 'completed';
    this.telemetry.progressPercent = 100;
    this.telemetry.remainingSeconds = 0;
    // Safe finish park (never below the Z floor)
    const spec = PRINTER_SPECS[this.currentModel];
    const parkZ = Math.min(spec.height, Math.max(30, getTravelZ(this.currentZCalibration)));
    this.telemetry.hotendPos = { x: 10, y: spec.depth - 15, z: parkZ };
    this.updatePenPosition();
    this.log('Plot successfully finished! Bed presented to user.');
    this.notify();
  }

  public getTelemetry(): MachineTelemetry {
    return { ...this.telemetry };
  }
}

export const bambuMachine = new BambuMachineController();
