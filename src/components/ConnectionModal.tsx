import React, { useState, useEffect } from 'react';
import {
  X,
  Wifi,
  Cpu,
  Check,
  AlertCircle,
  ShieldCheck,
  Eye,
  EyeOff,
  RefreshCw,
  LogOut,
  Radio,
  Server,
  KeyRound,
  Hash,
  Globe,
  User,
} from 'lucide-react';
import { BambuConnectionConfig } from '../types/plotter';
import { bambuMachine } from '../services/bambuService';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionMode: 'mqtt' | 'simulator';
  onSaveConnection: (mode: 'mqtt' | 'simulator', config?: BambuConnectionConfig) => void;
}

export type ConnectionSubMode = 'bridge' | 'direct' | 'simulator';

export const ConnectionModal: React.FC<ConnectionModalProps> = ({
  isOpen,
  onClose,
  connectionMode,
  onSaveConnection,
}) => {
  const telemetry = bambuMachine.getTelemetry();

  const isRemoteHosted =
    typeof window !== 'undefined' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  // Submode: default to 'bridge' if hosted remotely, or 'simulator' if currently simulator
  const [subMode, setSubMode] = useState<ConnectionSubMode>(() => {
    if (connectionMode === 'simulator') return 'simulator';
    return isRemoteHosted ? 'bridge' : 'direct';
  });

  // Bridge / ngrok credentials
  const [bridgeUrl, setBridgeUrl] = useState<string>(
    () => localStorage.getItem('bambu_bridge_url') || '2579-69-49-59-238.ngrok-free.app'
  );
  const [bridgePort, setBridgePort] = useState<string>(
    () => localStorage.getItem('bambu_bridge_port') || '443'
  );
  const [bridgeUser, setBridgeUser] = useState<string>(
    () => localStorage.getItem('bambu_bridge_user') || 'remote'
  );
  const [bridgePass, setBridgePass] = useState<string>(
    () => localStorage.getItem('bambu_bridge_pass') || ''
  );
  const [serial, setSerial] = useState<string>(
    () => localStorage.getItem('bambu_serial') || '0300CA662401354'
  );

  // Direct LAN credentials
  const [directIp, setDirectIp] = useState<string>(
    () => localStorage.getItem('bambu_direct_ip') || '192.168.1.150'
  );
  const [directCode, setDirectCode] = useState<string>(
    () => localStorage.getItem('bambu_direct_code') || ''
  );

  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verifyStatus, setVerifyStatus] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setVerifySuccess(null);
      setVerifyError(null);
      setVerifyStatus(null);
      setResolvedUrl(null);
      setFieldErrors({});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};

    const cleanSerial = serial.trim().toUpperCase();
    if (!cleanSerial) {
      errors.serial = 'Printer Serial Number is required.';
    } else if (!/^[0-9A-Z]{15,16}$/.test(cleanSerial)) {
      errors.serial = 'Must be 15 or 16 alphanumeric characters (e.g. 0300CA662401354).';
    }

    if (subMode === 'bridge') {
      const cleanUrl = bridgeUrl.trim();
      if (!cleanUrl) {
        errors.bridgeUrl = 'ngrok URL or broker host is required.';
      }
      if (!bridgeUser.trim()) {
        errors.bridgeUser = 'Username is required (default "remote" for Mosquitto).';
      }
      if (!bridgePass) {
        errors.bridgePass = 'Password is required (from Mosquitto passwd).';
      }
    } else if (subMode === 'direct') {
      const cleanIp = directIp.trim();
      const ipv4Regex =
        /^(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$/;
      const hostnameRegex = /^[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z0-9]+$|^[a-zA-Z0-9-]+$/;

      if (!cleanIp) {
        errors.directIp = 'IP Address is required.';
      } else if (!ipv4Regex.test(cleanIp) && !hostnameRegex.test(cleanIp)) {
        errors.directIp = 'Invalid IPv4 address format (e.g. 192.168.1.150).';
      }

      const cleanCode = directCode.trim();
      if (!cleanCode) {
        errors.directCode = '8-digit LAN Access Code is required.';
      } else if (!/^[0-9A-Za-z]{8}$/.test(cleanCode)) {
        errors.directCode = 'Must be exactly 8 characters (Settings > WLAN > Access Code).';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const performCheck = async (autoConnect: boolean): Promise<boolean> => {
    setVerifyError(null);
    setVerifySuccess(null);
    setResolvedUrl(null);

    if (subMode === 'simulator') {
      bambuMachine.connectSimulator();
      onSaveConnection('simulator');
      onClose();
      return true;
    }

    if (!validateForm()) return false;

    setIsVerifying(true);

    const isBridgeMode = subMode === 'bridge';
    const target = isBridgeMode ? bridgeUrl.trim() : directIp.trim();
    const port = isBridgeMode ? (bridgePort ? parseInt(bridgePort, 10) : 443) : 8883;
    const username = isBridgeMode ? bridgeUser.trim() : 'bblp';
    const password = isBridgeMode ? bridgePass : directCode.trim();
    const cleanSerial = serial.trim().toUpperCase();

    setVerifyStatus(`Connecting to ${target}${port ? ':' + port : ''}...`);

    try {
      const endpoint = autoConnect ? '/api/bambu/connect' : '/api/bambu/verify';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: target,
          port,
          username,
          accessCode: password,
          serialNumber: cleanSerial,
          isBridge: isBridgeMode,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setVerifyError(data.error || 'Authentication check failed.');
        setResolvedUrl(data.resolvedUrl || null);
        setIsVerifying(false);
        setVerifyStatus(null);
        return false;
      }

      // Success!
      setVerifySuccess(data.message || `Successfully connected to broker for printer ${cleanSerial}!`);
      setResolvedUrl(data.resolvedUrl || null);
      setIsVerifying(false);
      setVerifyStatus(null);

      // Save valid settings
      localStorage.setItem('bambu_serial', cleanSerial);
      if (isBridgeMode) {
        localStorage.setItem('bambu_bridge_url', target);
        localStorage.setItem('bambu_bridge_port', String(port));
        localStorage.setItem('bambu_bridge_user', username);
        localStorage.setItem('bambu_bridge_pass', password);
      } else {
        localStorage.setItem('bambu_direct_ip', target);
        localStorage.setItem('bambu_direct_code', password);
      }

      if (autoConnect) {
        bambuMachine.connectMqtt(target, cleanSerial);
        onSaveConnection('mqtt', {
          ip: target,
          serialNumber: cleanSerial,
          accessCode: password,
          port,
          username,
          isBridge: isBridgeMode,
        });
        setTimeout(() => onClose(), 1000);
      }

      return true;
    } catch (err: any) {
      setVerifyError(err.message || 'Network error communicating with Bambu link service.');
      setIsVerifying(false);
      setVerifyStatus(null);
      return false;
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/bambu/disconnect', { method: 'POST' });
    } catch (_) {}
    bambuMachine.disconnect();
    setVerifySuccess(null);
    setVerifyError(null);
    onSaveConnection('simulator');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-[#121620] border border-[#232b3b] rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#232b3b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
            <div>
              <h3 className="text-base font-bold text-white leading-tight">Bambu Printer Link</h3>
              <p className="text-[11px] text-slate-400">
                MQTT broker handshake, ngrok tunnel relay, or virtual simulator
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto">
          {/* 3 Mode Selector Tabs */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                setSubMode('bridge');
                setVerifyError(null);
                setVerifySuccess(null);
              }}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                subMode === 'bridge'
                  ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold ring-1 ring-emerald-500/30'
                  : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>ngrok / Bridge</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-1 leading-snug">
                For Mosquitto tunnel & hosted cloud
              </div>
            </button>

            <button
              onClick={() => {
                setSubMode('direct');
                setVerifyError(null);
                setVerifySuccess(null);
              }}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                subMode === 'direct'
                  ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold ring-1 ring-emerald-500/30'
                  : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Wifi className="w-3.5 h-3.5 text-indigo-400" />
                <span>Direct LAN</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-1 leading-snug">
                Direct TLS (8883) on same Wi-Fi
              </div>
            </button>

            <button
              onClick={() => {
                setSubMode('simulator');
                setVerifyError(null);
                setVerifySuccess(null);
              }}
              className={`p-2.5 rounded-lg border text-left transition-all ${
                subMode === 'simulator'
                  ? 'bg-emerald-950/40 border-emerald-500 text-emerald-300 font-semibold ring-1 ring-emerald-500/30'
                  : 'bg-[#0d1017] border-[#222b3a] text-slate-400 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Cpu className="w-3.5 h-3.5 text-emerald-400" />
                <span>Simulator</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-1 leading-snug">
                Pure browser toolpath simulation
              </div>
            </button>
          </div>

          {/* Currently Connected Badge */}
          {telemetry.isConnected && (
            <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/40 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-emerald-300 font-semibold">
                  Connected: {telemetry.isSimulated ? 'Virtual Simulator' : `Bambu (${telemetry.connectedIp || 'Active'})`}
                </span>
              </div>
              <button
                onClick={handleDisconnect}
                className="px-2.5 py-1 rounded bg-[#1e2533] hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 text-[11px] font-medium transition-colors flex items-center gap-1"
              >
                <LogOut className="w-3 h-3" />
                <span>Disconnect</span>
              </button>
            </div>
          )}

          {/* TAB 1: ngrok / Mosquitto Bridge (User's Exact Setup) */}
          {subMode === 'bridge' && (
            <div className="space-y-3 pt-1">
              <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-500/30 text-[11px] text-cyan-300 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span>
                  Connects to your local Mosquitto bridge via ngrok WebSocket/TLS. Uses your Mosquitto username (<code className="text-white font-mono">remote</code>) and password.
                </span>
              </div>

              {/* ngrok Host / URL */}
              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-cyan-400" />
                    <span>ngrok Tunnel Host or WebSocket URL</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Port 443 / 9001</span>
                </label>
                <input
                  type="text"
                  value={bridgeUrl}
                  onChange={(e) => {
                    setBridgeUrl(e.target.value);
                    if (fieldErrors.bridgeUrl) setFieldErrors((prev) => ({ ...prev, bridgeUrl: '' }));
                  }}
                  placeholder="e.g. 2579-69-49-59-238.ngrok-free.app"
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                />
                {fieldErrors.bridgeUrl && (
                  <p className="text-[10px] text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldErrors.bridgeUrl}
                  </p>
                )}
              </div>

              {/* Port & Username in 2 columns */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                    Port
                  </label>
                  <input
                    type="text"
                    value={bridgePort}
                    onChange={(e) => setBridgePort(e.target.value)}
                    placeholder="443"
                    className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                  />
                  <span className="text-[9px] text-slate-500 mt-0.5 block">
                    443 for ngrok HTTPS/WSS
                  </span>
                </div>

                <div>
                  <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-300 mb-1">
                    <User className="w-3 h-3 text-slate-400" />
                    <span>Mosquitto User</span>
                  </label>
                  <input
                    type="text"
                    value={bridgeUser}
                    onChange={(e) => setBridgeUser(e.target.value)}
                    placeholder="remote"
                    className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                  />
                  <span className="text-[9px] text-slate-500 mt-0.5 block">
                    From mosquitto.conf ACL
                  </span>
                </div>
              </div>

              {/* Mosquitto Password */}
              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    <span>Mosquitto Password (for &apos;{bridgeUser}&apos;)</span>
                  </span>
                  <span className="text-[10px] text-slate-400">From C:/bambu/passwd</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={bridgePass}
                    onChange={(e) => {
                      setBridgePass(e.target.value);
                      if (fieldErrors.bridgePass) setFieldErrors((prev) => ({ ...prev, bridgePass: '' }));
                    }}
                    placeholder="Password for Mosquitto remote user"
                    className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {fieldErrors.bridgePass && (
                  <p className="text-[10px] text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldErrors.bridgePass}
                  </p>
                )}
              </div>

              {/* Serial Number */}
              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Printer Serial Number</span>
                  </span>
                  <span className="text-[10px] text-slate-400">device/&lt;serial&gt;/report</span>
                </label>
                <input
                  type="text"
                  value={serial}
                  onChange={(e) => {
                    setSerial(e.target.value.toUpperCase());
                    if (fieldErrors.serial) setFieldErrors((prev) => ({ ...prev, serial: '' }));
                  }}
                  placeholder="e.g. 0300CA662401354"
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                />
                {fieldErrors.serial && (
                  <p className="text-[10px] text-rose-400 mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {fieldErrors.serial}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Direct LAN Connection */}
          {subMode === 'direct' && (
            <div className="space-y-3.5 pt-1">
              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Printer Local IP Address</span>
                  </span>
                  <span className="text-[10px] text-slate-400">Port 8883 TLS</span>
                </label>
                <input
                  type="text"
                  value={directIp}
                  onChange={(e) => setDirectIp(e.target.value)}
                  placeholder="e.g. 192.168.1.150"
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Printer Serial Number</span>
                  </span>
                  <span className="text-[10px] text-slate-400">15–16 chars</span>
                </label>
                <input
                  type="text"
                  value={serial}
                  onChange={(e) => setSerial(e.target.value.toUpperCase())}
                  placeholder="e.g. 0300CA662401354"
                  className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="flex items-center justify-between text-[11px] font-semibold text-slate-300 mb-1">
                  <span className="flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    <span>LAN Access Code</span>
                  </span>
                  <span className="text-[10px] text-slate-400">8-digit touchscreen code</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={directCode}
                    onChange={(e) => setDirectCode(e.target.value)}
                    placeholder="8-character code"
                    className="w-full bg-[#0b0e14] border border-[#232b3b] text-white rounded-lg pl-3 pr-10 py-2 text-xs font-mono focus:outline-hidden focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Virtual Simulator */}
          {subMode === 'simulator' && (
            <div className="p-4 rounded-lg bg-[#0d1017] border border-[#222b3a] space-y-2.5">
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <Cpu className="w-4 h-4" />
                <span>Virtual Hardware Simulation</span>
              </span>
              <p className="text-xs text-slate-300 leading-relaxed">
                Full Bambu Lab A1 / A1 Mini stepper kinematics, bed slinger inertia, pen-up/pen-down Z travel, and color swap pauses emulated entirely in your canvas.
              </p>
              <ul className="text-[11px] text-slate-400 space-y-1 list-disc list-inside">
                <li>No physical Wi-Fi connection, ngrok tunnel, or printer needed</li>
                <li>Live stroke-by-stroke canvas drawing visualization</li>
                <li>Accurate acceleration and feedrate simulation</li>
              </ul>
            </div>
          )}

          {/* Live Progress */}
          {isVerifying && (
            <div className="p-3 rounded-lg bg-cyan-950/30 border border-cyan-500/40 text-xs text-cyan-300 flex items-center gap-2.5">
              <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
              <span>{verifyStatus || 'Connecting to broker...'}</span>
            </div>
          )}

          {/* Error Alert */}
          {verifyError && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-500/50 text-xs text-rose-300 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Authentication / Connection Failed</span>
              </div>
              <p className="text-[11px] text-rose-300/90 leading-relaxed font-mono pl-5">
                {verifyError}
              </p>
              {resolvedUrl && (
                <p className="text-[10px] text-slate-400 font-mono pl-5">
                  Attempted Target: {resolvedUrl}
                </p>
              )}
            </div>
          )}

          {/* Success Alert */}
          {verifySuccess && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/50 text-xs text-emerald-300 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-emerald-200">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Broker Handshake Verified</span>
              </div>
              <p className="text-[11px] text-emerald-300/90 leading-relaxed font-mono pl-5">
                {verifySuccess}
              </p>
              {resolvedUrl && (
                <p className="text-[10px] text-emerald-400/80 font-mono pl-5">
                  Connected Target: {resolvedUrl}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-[#232b3b] bg-[#0c0f16] flex items-center justify-between gap-2 shrink-0">
          <div>
            {subMode !== 'simulator' && (
              <button
                type="button"
                onClick={() => performCheck(false)}
                disabled={isVerifying}
                className="px-3.5 py-2 bg-[#1b2230] hover:bg-[#253043] disabled:opacity-50 text-slate-200 rounded-lg text-xs font-semibold border border-[#2b374d] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                <span>Test Handshake</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              onClick={() => performCheck(true)}
              disabled={isVerifying}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold shadow-md shadow-emerald-950/40 transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {isVerifying ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Checking...</span>
                </>
              ) : subMode === 'simulator' ? (
                <>
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Use Virtual Engine</span>
                </>
              ) : (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Verify &amp; Connect</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
