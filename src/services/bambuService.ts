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
  BufferQueueState,
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
  private bufferState: BufferQueueState = {
    totalCommands: 0,
    sentCommands: 0,
    acknowledgedCommands: 0,
    inFlightChunks: 0,
    bufferHealth: 'idle',
    activeBatchGcode: '',
    activeChunkIndex: 0,
    totalChunks: 0,
    estimatedRemainingSeconds: 0,
  };

  private telemetry: MachineTelemetry = {
    isConnected: false,
    isSimulated: true,
    connectionMode: 'simulator',
    state: 'idle',
    hotendPos: { x: 90, y: 90, z: 25 },
    penPos: { x: 90, y: 61, z: 25 },
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
    bufferQueue: {
      totalCommands: 0,
      sentCommands: 0,
      acknowledgedCommands: 0,
      inFlightChunks: 0,
      bufferHealth: 'idle',
      activeBatchGcode: '',
      activeChunkIndex: 0,
      totalChunks: 0,
      estimatedRemainingSeconds: 0,
    },
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
   * Send G-code and ensure trailing newline before dispatch.
   */
  private async sendGcodeAndWait(
    gcode: string,
    _x?: number,
    _y?: number,
    _z?: number,
    _waitForPos?: boolean
  ): Promise<PrinterCommandResponse> {
    const formatted = gcode.endsWith('\n') ? gcode : `${gcode}\n`;
    return this.sendGcodeDirect(formatted);
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
    this.telemetry.bufferQueue = { ...this.bufferState };
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

  /**
   * Safe homing without pen installed: runs G28, then raises toolhead 30mm clear of bed.
   */
  public async safeHomeNoPen(): Promise<{ success: boolean; error?: string }> {
    this.telemetry.state = 'homing';
    this.log('Safe Homing: Running G28 without pen installed. Toolhead will touch bed once to establish origin.');
    this.notify();

    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.ensurePrinterInitialized();
      const res = await this.sendGcodeDirect('G28\nG0 Z30 F1800\n');
      if (!res.success) {
        this.telemetry.state = 'idle';
        this.log(`Homing failed: ${res.error || 'Unknown error'}`);
        this.notify();
        return { success: false, error: res.error };
      }
    } else {
      await new Promise((r) => setTimeout(r, 800));
    }

    this.telemetry.hotendPos = { x: 0, y: 0, z: 30 };
    this.trackedPos = { x: 0, y: 0, z: 30, isValid: true, lastUpdated: Date.now() };
    this.hasLivePosition = true;
    this.telemetry.state = 'idle';
    this.log('Safe Homing complete. Toolhead lifted to Z=30mm. Ready for Service Station move.');
    this.updatePenPosition();
    this.notify();
    return { success: true };
  }

  /**
   * Move to front service hover station for pen clamping while nozzle floats high in the air (20-30mm).
   * Disables bed leveling mesh compensation (G29.2 S0 and M420 S0) with M400 barriers to prevent Z-drift.
   */
  public async prepareHoverStation(hoverZ = 25.0): Promise<{ success: boolean; error?: string }> {
    const spec = PRINTER_SPECS[this.currentModel];
    const parkX = Math.round(spec.width / 2);
    const parkY = 25;
    const safeHoverZ = Math.max(15, Math.min(50, hoverZ));

    this.log(`Moving to Floating Hover Station: X${parkX} Y${parkY} Z${safeHoverZ}mm. Disabling ABL mesh compensation.`);
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.ensurePrinterInitialized();
      // Ensure buffer is flushed, disable leveling mesh, and move to hover height
      await this.sendGcodeDirect(`M400\nG29.2 S0\nM420 S0\nM400\nG0 Z${safeHoverZ.toFixed(2)} F1800\nG0 X${parkX} Y${parkY} F4000\nM400\n`);
    } else {
      await new Promise((r) => setTimeout(r, 500));
    }

    this.telemetry.hotendPos = { x: parkX, y: parkY, z: safeHoverZ };
    this.trackedPos = { x: parkX, y: parkY, z: safeHoverZ, isValid: true, lastUpdated: Date.now() };
    this.hasLivePosition = true;
    this.updatePenPosition();
    this.notify();
    this.log(`Nozzle is safely floating at Z=${safeHoverZ}mm (well clear of bed). Loosen mount thumbscrew, drop pen under gravity to touch paper, and gently clamp.`);
    return { success: true };
  }

  /**
   * Backward-compatible alias for prepareHoverStation
   */
  public async moveToServiceStation(): Promise<{ success: boolean; error?: string }> {
    return this.prepareHoverStation(25.0);
  }

  /**
   * Backward-compatible alias for hover seating height
   */
  public async descendForPenSeating(targetZ = 25): Promise<{ success: boolean; error?: string }> {
    return this.prepareHoverStation(targetZ);
  }

  /**
   * Lock paper zero via G92 Z0 with strict M400 synchronization barriers, then raise to travel clearance.
   */
  public async lockPaperZeroG92(travelLift = 3.5): Promise<{ success: boolean; error?: string }> {
    const lift = clampPenRelease(travelLift);
    this.log(`Locking Paper Zero (G92 Z0): Current pen position locked as Z=0.0mm. Lifting to Z=${lift.toFixed(2)}mm travel plane.`);
    
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      // Flush planner queue, set work coordinate datum to 0, flush again, then lift
      await this.sendGcodeDirect(`M400\nG92 Z0\nM400\nG0 Z${lift.toFixed(2)} F1800\nM400\n`);
    } else {
      await new Promise((r) => setTimeout(r, 300));
    }

    const nextCal: ZCalibration = {
      bedReferenceZ: 0,
      hoverZMm: 25.0,
      penReleaseMm: lift,
      isCalibrated: true,
      datumSource: 'pen_drop',
      datumCapturedAt: new Date().toISOString(),
      paperZeroSet: true,
    };
    this.emitZCalibration(nextCal);

    this.telemetry.hotendPos.z = lift;
    this.trackedPos.z = lift;
    this.hasLivePosition = true;
    this.updatePenPosition();
    this.log('Paper Zero successfully locked! Travel plane active. The nozzle remains floating safely in the air.');
    this.notify();
    return { success: true };
  }

  /**
   * Immediate Emergency Lift Pen: Lifts the pen toolhead by 10mm to prevent ink bleeds.
   */
  public async emergencyLiftPen(): Promise<{ success: boolean }> {
    const liftZ = Math.min(
      PRINTER_SPECS[this.currentModel].height,
      Math.max(10, this.telemetry.hotendPos.z + 10)
    );
    this.log(`Emergency Lift Pen: Retracting Z to ${liftZ.toFixed(1)}mm immediately.`);
    if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
      await this.sendGcodeDirect(`M400\nG0 Z${liftZ.toFixed(2)} F2400\nM400\n`);
    }
    this.telemetry.hotendPos.z = liftZ;
    this.trackedPos.z = liftZ;
    this.updatePenPosition();
    this.notify();
    return { success: true };
  }

  public async startPlot(job: SlicedPlotJob) {
    if (this.isRunning) return;

    // Validate calibrated Z datum exists
    const blockReason = getZBlockReason(this.currentZCalibration);
    if (blockReason && !this.currentZCalibration.paperZeroSet && this.currentZCalibration.datumSource !== 'pen_drop') {
      this.telemetry.state = 'error';
      this.log(`SAFETY BLOCK: ${blockReason}`);
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

    // Count total executable motion moves
    let totalMotionMoves = 0;
    job.layersByPen.forEach((layer) => {
      layer.strokeSegments.forEach((seg) => {
        totalMotionMoves += 1 + (seg.isPeck ? 2 : 2 + Math.max(0, seg.points.length - 1));
      });
    });

    const totalChunks = Math.max(1, Math.ceil(totalMotionMoves / 15));
    this.bufferState = {
      totalCommands: totalMotionMoves,
      sentCommands: 0,
      acknowledgedCommands: 0,
      inFlightChunks: 0,
      bufferHealth: 'streaming',
      activeBatchGcode: 'Initializing plot sequence...',
      activeChunkIndex: 0,
      totalChunks,
      estimatedRemainingSeconds: job.estimatedSeconds,
    };

    this.log(
      `Plot started: ${job.layersByPen.length} pen layers, ${this.telemetry.totalStrokes} total paths, ~${totalChunks} synchronized M400 batches.`
    );
    this.notify();

    // Start elapsed timer
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => {
      if (this.isRunning && !this.isPaused && this.telemetry.state === 'plotting') {
        this.telemetry.elapsedSeconds += 1;
        this.telemetry.remainingSeconds = Math.max(0, this.telemetry.remainingSeconds - 1);
        this.bufferState.estimatedRemainingSeconds = this.telemetry.remainingSeconds;
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

    // Multi-color swap check
    if (this.activeJob.layersByPen.length > 1 && layerIndex > 0) {
      this.log(
        `Color swap required: Layer ${layerIndex + 1}/${this.activeJob.layersByPen.length} -> ${layer.pen.name} (${layer.pen.hex})`
      );
      this.telemetry.state = 'waiting_pen_change';
      this.telemetry.pendingColorChange = {
        nextPen: layer.pen,
        penIndex: layerIndex,
        totalPens: this.activeJob.layersByPen.length,
      };

      const spec = PRINTER_SPECS[this.currentModel];
      const travelZ = getTravelZ(this.currentZCalibration);
      const parkX = Math.round(spec.width / 2);
      const parkY = 20;

      if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
        await this.sendGcodeDirect(`G0 Z${travelZ.toFixed(2)} F2400\nG0 X${parkX} Y${parkY} F4000\nM400\n`);
      }

      this.telemetry.hotendPos = { x: parkX, y: parkY, z: travelZ };
      this.updatePenPosition();
      this.bufferState.bufferHealth = 'paused';
      this.bufferState.activeBatchGcode = `PAUSED for pen swap: [${layer.pen.name}]`;
      this.notify();
      return;
    }

    await this.plotLayerWithChunkedBuffer(layer, layerIndex);
  }

  public async resumePlotAfterColorSwap() {
    if (!this.isRunning || !this.activeJob || this.telemetry.state !== 'waiting_pen_change') return;

    const currentLayerIdx = this.telemetry.currentPenIndex;
    const pen = this.telemetry.currentPen;

    this.log(`Pen confirmed: [${pen?.name}]. Resuming plot...`);
    this.telemetry.pendingColorChange = undefined;
    this.telemetry.state = 'plotting';
    this.bufferState.bufferHealth = 'streaming';
    this.notify();

    const layer = this.activeJob.layersByPen[currentLayerIdx];
    await this.plotLayerWithChunkedBuffer(layer, currentLayerIdx);
  }

  /**
   * Execute strokes in chunked batches with M400 synchronization barriers.
   * Eliminates buffer overruns and packet drops while pacing telemetry and canvas stamping.
   */
  private async plotLayerWithChunkedBuffer(layer: any, layerIndex: number) {
    if (!this.isRunning || !this.activeJob) return;

    const travelFeedrate = QUALITY_PRESETS[this.currentQuality].travelFeedrate;
    const defaultDrawFeedrate = QUALITY_PRESETS[this.currentQuality].drawFeedrate;
    const zLiftFeedrate = QUALITY_PRESETS[this.currentQuality].zLiftFeedrate;
    const accel = QUALITY_PRESETS[this.currentQuality].acceleration;
    const drawZ = getDrawZ(this.currentZCalibration);
    const travelZ = getTravelZ(this.currentZCalibration);

    // Initial setup if first layer
    if (layerIndex === 0) {
      const initGcode = `G90\nG21\nG29.2 S0\nM204 P${accel} T${accel}\nG0 Z${travelZ.toFixed(2)} F${zLiftFeedrate}\nM400\n`;
      if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
        await this.sendGcodeDirect(initGcode);
      }
      this.telemetry.hotendPos.z = travelZ;
      this.updatePenPosition();
    }

    interface PlotAction {
      cmd: string;
      distMm: number;
      feedrate: number;
      isStroke?: boolean;
      strokeData?: { x1: number; y1: number; x2: number; y2: number };
      isDot?: boolean;
      dotData?: { x: number; y: number };
    }

    const actions: PlotAction[] = [];

    for (const segment of layer.strokeSegments) {
      if (segment.points.length === 0) continue;
      const p0 = segment.points[0];
      const startX = p0.x - this.currentPenOffset.x;
      const startY = p0.y - this.currentPenOffset.y;

      // 1. Rapid move to stroke start (Pen UP)
      actions.push({
        cmd: `G0 X${startX.toFixed(2)} Y${startY.toFixed(2)} F${travelFeedrate}`,
        distMm: 20,
        feedrate: travelFeedrate,
      });

      if (segment.isPeck) {
        // Stipple dot plunge
        actions.push({
          cmd: `G1 Z${drawZ.toFixed(2)} F${zLiftFeedrate}`,
          distMm: travelZ - drawZ,
          feedrate: zLiftFeedrate,
          isDot: true,
          dotData: { x: p0.x, y: p0.y },
        });
        // Lift
        actions.push({
          cmd: `G0 Z${travelZ.toFixed(2)} F${zLiftFeedrate}`,
          distMm: travelZ - drawZ,
          feedrate: zLiftFeedrate,
        });
      } else {
        // Lower pen
        actions.push({
          cmd: `G1 Z${drawZ.toFixed(2)} F${zLiftFeedrate}`,
          distMm: travelZ - drawZ,
          feedrate: zLiftFeedrate,
        });

        // Stroke points
        const effectivePreset: QualityPreset = segment.qualityPreset || this.currentQuality;
        const strokeFeedrate = QUALITY_PRESETS[effectivePreset]?.drawFeedrate || defaultDrawFeedrate;

        let prev = p0;
        for (let i = 1; i < segment.points.length; i++) {
          const pt = segment.points[i];
          const mx = pt.x - this.currentPenOffset.x;
          const my = pt.y - this.currentPenOffset.y;
          const dist = Math.hypot(pt.x - prev.x, pt.y - prev.y);

          actions.push({
            cmd: `G1 X${mx.toFixed(2)} Y${my.toFixed(2)} F${strokeFeedrate}`,
            distMm: dist,
            feedrate: strokeFeedrate,
            isStroke: true,
            strokeData: { x1: prev.x, y1: prev.y, x2: pt.x, y2: pt.y },
          });
          prev = pt;
        }

        // Lift pen
        actions.push({
          cmd: `G0 Z${travelZ.toFixed(2)} F${zLiftFeedrate}`,
          distMm: travelZ - drawZ,
          feedrate: zLiftFeedrate,
        });
      }
    }

    const CHUNK_SIZE = 15;
    const chunks: PlotAction[][] = [];
    for (let i = 0; i < actions.length; i += CHUNK_SIZE) {
      chunks.push(actions.slice(i, i + CHUNK_SIZE));
    }

    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      if (!this.isRunning) return;

      while (this.isPaused) {
        this.bufferState.bufferHealth = 'paused';
        this.notify();
        await new Promise((r) => setTimeout(r, 100));
        if (!this.isRunning) return;
      }

      const chunk = chunks[cIdx];
      const gcodeLines = chunk.map((a) => a.cmd);
      const batchGcode = gcodeLines.join('\n') + '\nM400\n';

      // Update buffer tracking: Sending chunk
      this.bufferState.activeChunkIndex = cIdx + 1;
      this.bufferState.sentCommands += chunk.length;
      this.bufferState.inFlightChunks = 1;
      this.bufferState.bufferHealth = 'syncing';
      this.bufferState.activeBatchGcode = gcodeLines.slice(0, 3).join(' | ') + (gcodeLines.length > 3 ? ' ...' : '');
      this.notify();

      // Dispatch to real printer over MQTT
      if (this.telemetry.connectionMode === 'mqtt' && this.telemetry.isConnected) {
        await this.sendGcodeDirect(batchGcode);
      }

      // Calculate physical move time for pacing
      const moveDurationMs = chunk.reduce((sum, a) => {
        return sum + Math.max(10, (a.distMm / (a.feedrate / 60000)));
      }, 0);
      const pacingWaitMs = Math.max(40, Math.min(2500, Math.round(moveDurationMs) + 60));

      await new Promise((r) => setTimeout(r, pacingWaitMs));

      // Chunk acknowledged!
      this.bufferState.acknowledgedCommands += chunk.length;
      this.bufferState.inFlightChunks = 0;
      this.bufferState.bufferHealth = 'streaming';

      // Stamp visual strokes & dots onto canvas
      for (const act of chunk) {
        if (act.isStroke && act.strokeData) {
          this.strokeListeners.forEach((cb) =>
            cb(
              act.strokeData!.x1,
              act.strokeData!.y1,
              act.strokeData!.x2,
              act.strokeData!.y2,
              layer.pen.hex,
              layer.pen.diameter
            )
          );
        } else if (act.isDot && act.dotData) {
          this.dotListeners.forEach((cb) =>
            cb(act.dotData!.x, act.dotData!.y, layer.pen.hex, layer.pen.diameter)
          );
        }
      }

      this.telemetry.currentStrokeIndex = Math.min(
        this.telemetry.totalStrokes,
        this.telemetry.currentStrokeIndex + Math.max(1, Math.round(chunk.length / 3))
      );
      this.telemetry.progressPercent = Math.min(
        100,
        Math.round((this.bufferState.acknowledgedCommands / Math.max(1, this.bufferState.totalCommands)) * 100)
      );
      this.notify();
    }

    // Move to next layer
    this.executeLayerSequence(layerIndex + 1);
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
