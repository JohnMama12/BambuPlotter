import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import mqtt, { MqttClient } from 'mqtt';
import net from 'net';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * Server-side negative-Z interlock. The printer's own firmware is the physical
 * bed stop; this floor only guarantees that a bypassing client can never send
 * a negative Z. The app enforces the captured bed reference + 1 mm draw plane
 * on top of this.
 */
const Z_SAFETY_FLOOR_MM = (() => {
  const raw = parseFloat(process.env.PLOTTER_Z_FLOOR_MM || '0');
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
})();

function findUnsafeZMove(gcode: string): { z: number; line: string } | null {
  const lines = String(gcode || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!/^G0?[0-3](\s|$)/i.test(line)) continue;
    const zMatches = [...line.matchAll(/[Zz]\s*(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g)];
    for (const match of zMatches) {
      const z = parseFloat(match[1]);
      if (Number.isFinite(z) && z < Math.max(0, Z_SAFETY_FLOOR_MM) - 0.001) {
        return { z, line };
      }
    }
  }
  return null;
}

// Enable CORS for all origins (LAN access from any device)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Active connection state
interface ConnectedPrinterSession {
  ip: string;
  serialNumber: string;
  accessCode: string;
  username: string;
  port: number;
  protocol: string;
  client: MqttClient;
  lastReport: any;
  bridgeStatus: string;
  connectedAt: string;
}

let activeSession: ConnectedPrinterSession | null = null;

export interface ResolvedConnectionParams {
  protocol: 'mqtts' | 'mqtt' | 'wss' | 'ws';
  host: string;
  port: number;
  url: string;
  username: string;
  password?: string;
  serialNumber: string;
  isNgrok: boolean;
}

/**
 * Intelligently parse target endpoint (direct IP, ngrok URL, WebSocket, or TCP host:port)
 */
export function parseConnectionParams(
  target: string,
  rawPort: number | string | undefined,
  rawUsername: string | undefined,
  rawPassword: string | undefined,
  serialNumber: string
): ResolvedConnectionParams {
  let cleaned = (target || '').trim();

  let detectedProto: 'mqtts' | 'mqtt' | 'wss' | 'ws' | null = null;
  if (cleaned.startsWith('wss://')) {
    detectedProto = 'wss';
    cleaned = cleaned.replace(/^wss:\/\//i, '');
  } else if (cleaned.startsWith('ws://')) {
    detectedProto = 'ws';
    cleaned = cleaned.replace(/^ws:\/\//i, '');
  } else if (cleaned.startsWith('https://')) {
    detectedProto = 'wss';
    cleaned = cleaned.replace(/^https:\/\//i, '');
  } else if (cleaned.startsWith('http://')) {
    detectedProto = 'ws';
    cleaned = cleaned.replace(/^http:\/\//i, '');
  } else if (cleaned.startsWith('mqtts://')) {
    detectedProto = 'mqtts';
    cleaned = cleaned.replace(/^mqtts:\/\//i, '');
  } else if (cleaned.startsWith('mqtt://')) {
    detectedProto = 'mqtt';
    cleaned = cleaned.replace(/^mqtt:\/\//i, '');
  } else if (cleaned.startsWith('tcp://')) {
    detectedProto = 'mqtt';
    cleaned = cleaned.replace(/^tcp:\/\//i, '');
  }

  // Strip trailing slashes or subpaths
  let path = '';
  const slashIdx = cleaned.indexOf('/');
  if (slashIdx !== -1) {
    path = cleaned.substring(slashIdx);
    cleaned = cleaned.substring(0, slashIdx);
  }

  // Check if host includes inline port (e.g. 0.tcp.ngrok.io:12345 or 192.168.1.150:8883)
  let host = cleaned;
  let inlinePort: number | undefined = undefined;
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    const parsed = parseInt(parts[1], 10);
    if (!isNaN(parsed)) {
      inlinePort = parsed;
    }
  }

  let port = inlinePort;
  if (rawPort !== undefined && rawPort !== '') {
    const parsed = typeof rawPort === 'number' ? rawPort : parseInt(String(rawPort), 10);
    if (!isNaN(parsed)) {
      port = parsed;
    }
  }

  const isNgrok =
    host.includes('ngrok-free.app') ||
    host.includes('ngrok.io') ||
    host.includes('ngrok-free.dev') ||
    host.includes('ngrok.app');

  // Determine protocol if not explicitly given
  if (!detectedProto) {
    if (isNgrok) {
      if (port && port !== 443 && port !== 80) {
        // e.g. tcp.ngrok.io:12345 (ngrok tcp)
        detectedProto = 'mqtt';
      } else {
        // HTTP ngrok tunnel forwards to Mosquitto WebSocket listener (port 9001) over HTTPS/WSS
        detectedProto = 'wss';
      }
    } else if (port === 1883) {
      detectedProto = 'mqtt';
    } else if (port === 9001) {
      detectedProto = 'ws';
    } else {
      detectedProto = 'mqtts'; // Default Bambu TLS
    }
  }

  // Default port based on detected protocol
  if (!port) {
    if (detectedProto === 'wss') port = 443;
    else if (detectedProto === 'ws') port = 80;
    else if (detectedProto === 'mqtt') port = 1883;
    else port = 8883; // default Bambu TLS
  }

  // Build full MQTT client connection URL
  let url = '';
  if (detectedProto === 'wss' || detectedProto === 'ws') {
    // For Mosquitto websockets via ngrok, connect to root or /mqtt
    url = `${detectedProto}://${host}:${port}${path || ''}`;
  } else {
    url = `${detectedProto}://${host}:${port}`;
  }

  // Username: if not specified, default to 'remote' for ngrok/bridge, or 'bblp' for direct printer
  let username = (rawUsername || '').trim();
  if (!username) {
    username = isNgrok ? 'remote' : 'bblp';
  }

  return {
    protocol: detectedProto,
    host,
    port,
    url,
    username,
    password: rawPassword !== undefined ? String(rawPassword).trim() : '',
    serialNumber: (serialNumber || '').trim().toUpperCase(),
    isNgrok,
  };
}

/**
 * Validate credentials syntax
 */
export function validatePrinterCredentials(
  ip: string,
  serialNumber: string,
  accessCode: string,
  isBridge: boolean = false
) {
  const errors: string[] = [];

  const trimmedTarget = (ip || '').trim();
  const trimmedSerial = (serialNumber || '').trim().toUpperCase();
  const trimmedCode = (accessCode || '').trim();

  if (!trimmedTarget) {
    errors.push('Endpoint address (IP, hostname, or ngrok URL) cannot be blank.');
  }

  // Bambu Serial Number: 15 to 16 alphanumeric characters
  if (!trimmedSerial) {
    errors.push('Printer Serial Number cannot be blank.');
  } else if (!/^[0-9A-Z]{15,16}$/.test(trimmedSerial)) {
    errors.push(
      `Invalid Serial Number "${trimmedSerial}". Bambu serial numbers must be exactly 15 or 16 alphanumeric characters (e.g. 0300CA662401354).`
    );
  }

  // If direct Bambu LAN connection (not bridge), Access Code is strictly 8 alphanumeric characters
  if (!isBridge && !trimmedTarget.includes('ngrok')) {
    if (!trimmedCode) {
      errors.push('LAN Access Code cannot be blank.');
    } else if (!/^[0-9A-Za-z]{8}$/.test(trimmedCode)) {
      errors.push(
        `Invalid LAN Access Code "${trimmedCode}". Bambu direct access codes must be 8 alphanumeric characters.`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Perform real MQTT test handshake (supports WSS via ngrok, TCP Mosquitto, or Direct TLS Port 8883)
 */
function testBambuHandshake(
  params: ResolvedConnectionParams,
  timeoutMs = 6000
): Promise<{ success: boolean; message: string; printerReport?: any }> {
  return new Promise((resolve, reject) => {
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        try {
          mqttClient.end(true);
        } catch (_) {}
        reject({
          code: 'AUTH_TIMEOUT',
          message: `Connection timed out after ${timeoutMs / 1000}s connecting to ${params.url}. Ensure the bridge/broker is running and accessible.`,
        });
      }
    }, timeoutMs);

    const clientOptions: mqtt.IClientOptions = {
      username: params.username,
      password: params.password,
      rejectUnauthorized: false, // Bambu / self-signed certificates
      connectTimeout: timeoutMs,
      clientId: `bambu_plotter_${Math.random().toString(36).substring(2, 8)}`,
      clean: true,
      reconnectPeriod: 0,
      protocolVersion: 4, // MQTT 3.1.1
    };

    // If WebSocket / ngrok, pass ngrok-skip-browser-warning header
    if (params.protocol === 'wss' || params.protocol === 'ws') {
      (clientOptions as any).wsOptions = {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'User-Agent': 'BambuPlotterStudio/1.0',
        },
      };
    }

    const mqttClient = mqtt.connect(params.url, clientOptions);

    mqttClient.on('connect', () => {
      const reportTopic = `device/${params.serialNumber}/report`;
      const statusTopic = `bridge/${params.serialNumber}/status`;

      mqttClient.subscribe([reportTopic, statusTopic], () => {
        // Send pushall query to request immediate status
        mqttClient.publish(
          `device/${params.serialNumber}/request`,
          JSON.stringify({
            pushing: {
              sequence_id: '0',
              command: 'pushall',
            },
          })
        );
      });

      // Retained messages from Mosquitto bridge will arrive almost immediately
      const reportWait = setTimeout(() => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          try {
            mqttClient.end(true);
          } catch (_) {}
          resolve({
            success: true,
            message: `Handshake verified: Successfully connected to broker (${params.url}) as '${params.username}'.`,
          });
        }
      }, 1500);

      mqttClient.on('message', (t, payload) => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          clearTimeout(reportWait);
          let parsed: any = null;
          try {
            parsed = JSON.parse(payload.toString());
          } catch (_) {}
          try {
            mqttClient.end(true);
          } catch (_) {}
          resolve({
            success: true,
            message: `Handshake verified: Successfully authenticated with Bambu printer (${params.serialNumber}) via broker.`,
            printerReport: parsed,
          });
        }
      });
    });

    mqttClient.on('error', (err: any) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        try {
          mqttClient.end(true);
        } catch (_) {}

        const errorMsg = err.message || '';
        if (
          errorMsg.includes('Not authorized') ||
          errorMsg.includes('Bad username') ||
          err.code === 4 ||
          err.code === 5
        ) {
          reject({
            code: 'AUTH_FAILED',
            message: `Authentication Failed: Broker rejected username '${params.username}' or password. Check Mosquitto passwd / ACL or Bambu access code.`,
          });
        } else if (err.code === 'ECONNREFUSED') {
          reject({
            code: 'CONNECTION_REFUSED',
            message: `Connection Refused at ${params.url}. Ensure the broker/tunnel is running and listening.`,
          });
        } else {
          reject({
            code: 'MQTT_ERROR',
            message: `Connection Error to ${params.url}: ${errorMsg || 'Handshake failed'}`,
          });
        }
      }
    });
  });
}

// POST /api/bambu/verify - Tests connection and credentials
app.post('/api/bambu/verify', async (req: Request, res: Response) => {
  const { ip, serialNumber, accessCode, port, username, isBridge } = req.body || {};

  const validation = validatePrinterCredentials(ip, serialNumber, accessCode, isBridge);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      error: validation.errors.join(' '),
      errors: validation.errors,
    });
  }

  const params = parseConnectionParams(ip, port, username, accessCode, serialNumber);

  try {
    const result = await testBambuHandshake(params);
    return res.json({
      ...result,
      resolvedUrl: params.url,
      resolvedProtocol: params.protocol,
      resolvedPort: params.port,
      resolvedUsername: params.username,
    });
  } catch (err: any) {
    const statusCode = err.code === 'AUTH_FAILED' ? 401 : 400;
    return res.status(statusCode).json({
      success: false,
      code: err.code || 'CONNECTION_FAILED',
      error: err.message || 'Failed to authenticate with Bambu printer/broker.',
      resolvedUrl: params.url,
    });
  }
});

// POST /api/bambu/connect - Establishes persistent MQTT session
app.post('/api/bambu/connect', async (req: Request, res: Response) => {
  const { ip, serialNumber, accessCode, port, username, isBridge } = req.body || {};

  const validation = validatePrinterCredentials(ip, serialNumber, accessCode, isBridge);
  if (!validation.isValid) {
    return res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      error: validation.errors.join(' '),
      errors: validation.errors,
    });
  }

  const params = parseConnectionParams(ip, port, username, accessCode, serialNumber);

  // Disconnect existing session
  if (activeSession) {
    try {
      activeSession.client.end(true);
    } catch (_) {}
    activeSession = null;
  }

  try {
    // Authenticate first
    const testResult = await testBambuHandshake(params, 6000);

    const clientOptions: mqtt.IClientOptions = {
      username: params.username,
      password: params.password,
      rejectUnauthorized: false,
      clientId: `bambu_plotter_live_${Math.random().toString(36).substring(2, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
      keepalive: 60,
      protocolVersion: 4, // MQTT 3.1.1 (required for Bambu)
    };

    if (params.protocol === 'wss' || params.protocol === 'ws') {
      (clientOptions as any).wsOptions = {
        headers: {
          'ngrok-skip-browser-warning': 'true',
          'User-Agent': 'BambuPlotterStudio/1.0',
        },
      };
    }

    const client = mqtt.connect(params.url, clientOptions);

    activeSession = {
      ip: params.host,
      serialNumber: params.serialNumber,
      accessCode: params.password || '',
      username: params.username,
      port: params.port,
      protocol: params.protocol,
      client,
      lastReport: testResult.printerReport || null,
      bridgeStatus: 'online',
      connectedAt: new Date().toISOString(),
    };

    client.on('connect', () => {
      console.log('[MQTT] Client connected to broker');
      // Only subscribe to report topic - bridge/status causes disconnect on some A1/P1S printers
      client.subscribe(`device/${params.serialNumber}/report`, { qos: 1 });
      // Request initial pushall
      client.publish(
        `device/${params.serialNumber}/request`,
        JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall' } }),
        { qos: 1 }
      );
    });

    client.on('message', (topic, payload) => {
      try {
        if (!activeSession) return;
        if (topic.includes('status')) {
          activeSession.bridgeStatus = payload.toString().trim();
        } else {
          activeSession.lastReport = JSON.parse(payload.toString());
        }
      } catch (_) {}
    });

    client.on('error', (err: any) => {
      console.error('[Bambu MQTT Error]:', err.message, err.code || 'no-code', err);
    });

    client.on('close', () => {
      console.log('[MQTT] Client connection closed');
    });

    client.on('offline', () => {
      console.log('[MQTT] Client went offline');
    });

    client.on('reconnect', () => {
      console.log('[MQTT] Client reconnecting...');
    });

    client.on('disconnect', (packet) => {
      console.log('[MQTT] Disconnect packet:', packet);
    });

    return res.json({
      success: true,
      message: `Connected to Bambu broker (${params.url}) for printer ${params.serialNumber}.`,
      report: activeSession.lastReport,
      resolvedUrl: params.url,
    });
  } catch (err: any) {
    const statusCode = err.code === 'AUTH_FAILED' ? 401 : 400;
    return res.status(statusCode).json({
      success: false,
      code: err.code || 'CONNECTION_FAILED',
      error: err.message || 'Failed to connect to Bambu broker.',
      resolvedUrl: params.url,
    });
  }
});

// GET /api/bambu/status - Query current live session status and printer report
app.get('/api/bambu/status', (_req: Request, res: Response) => {
  if (!activeSession) {
    return res.json({
      isConnected: false,
      connectionMode: 'none',
      session: null,
    });
  }

  return res.json({
    isConnected: true,
    connectionMode: 'mqtt',
    ip: activeSession.ip,
    serialNumber: activeSession.serialNumber,
    username: activeSession.username,
    protocol: activeSession.protocol,
    port: activeSession.port,
    connectedAt: activeSession.connectedAt,
    bridgeStatus: activeSession.bridgeStatus,
    printerReport: activeSession.lastReport,
  });
});

// GET /api/bambu/events - Server-Sent Events for real-time printer reports
app.get('/api/bambu/events', (req: Request, res: Response) => {
  if (!activeSession) {
    return res.status(400).json({ error: 'No active printer session' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial report
  if (activeSession.lastReport) {
    res.write(`data: ${JSON.stringify(activeSession.lastReport)}\n\n`);
  }

  // Listen for new reports
  const onMessage = (topic: string, payload: Buffer) => {
    if (topic.includes('report') && activeSession) {
      try {
        const report = JSON.parse(payload.toString());
        res.write(`data: ${JSON.stringify(report)}\n\n`);
      } catch (_) {}
    }
  };

  activeSession.client.on('message', onMessage);

  // Cleanup on disconnect
  req.on('close', () => {
    activeSession?.client.off('message', onMessage);
  });
});

// POST /api/bambu/command - Relay commands to device/<serial>/request
app.post('/api/bambu/command', (req: Request, res: Response) => {
  console.log('[CMD] Received command:', JSON.stringify(req.body));
  console.log('[CMD] activeSession exists:', !!activeSession);
  console.log('[CMD] client connected:', activeSession?.client?.connected);

  if (!activeSession || !activeSession.client.connected) {
    return res.status(400).json({ success: false, error: 'Printer is not connected', debug: { hasSession: !!activeSession, clientConnected: activeSession?.client?.connected } });
  }

  const { command, payload, gcode, sequence_id } = req.body || {};
  const topic = `device/${activeSession.serialNumber}/request`;

  // HARD SAFETY INTERLOCK: reject any raw G-code Z move below the floor.
  if (gcode) {
    const unsafe = findUnsafeZMove(gcode);
    if (unsafe) {
      const message = `SAFETY BLOCK: refused G-code "${unsafe.line}" because Z${unsafe.z} is below the ${Z_SAFETY_FLOOR_MM}mm bed-clearance floor.`;
      console.warn('[CMD] ' + message);
      return res.status(400).json({ success: false, error: message });
    }
  }

  let msg: any;

  if (gcode) {
    // Raw G-code command - Bambu printers accept G-code via the print command with gcode_line
    msg = {
      print: {
        sequence_id: sequence_id || String(Date.now()),
        command: 'gcode_line',
        param: gcode,
      },
    };
  } else if (command) {
    // Bambu-specific command (pushall, homing, etc.)
    // payload may contain additional parameters, merge with command
    msg = {
      print: {
        sequence_id: sequence_id || payload?.sequence_id || String(Date.now()),
        command,
        ...payload,
      },
    };
  } else {
    return res.status(400).json({ success: false, error: 'No command or gcode provided' });
  }

  console.log('[CMD] Publishing to topic:', topic, 'msg:', JSON.stringify(msg));
  activeSession.client.publish(topic, JSON.stringify(msg), { qos: 1 });
  return res.json({ success: true, message: `Command dispatched to printer.` });
});

// POST /api/bambu/disconnect - Disconnect active session
app.post('/api/bambu/disconnect', (_req: Request, res: Response) => {
  if (activeSession) {
    try {
      activeSession.client.end(true);
    } catch (_) {}
    activeSession = null;
  }
  return res.json({ success: true, message: 'Disconnected from Bambu printer broker.' });
});

// Vite Integration
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Bambu Plotter Studio] Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
