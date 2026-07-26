import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { supabaseCloud } from '../../config/supabaseCloud';
import { showToast } from '../Toast';
import { 
    QrCode, Smartphone, RefreshCw, X, Copy, Check, 
    ShieldAlert, Trash2, Clock, CheckCircle2, AlertTriangle 
} from 'lucide-react';

export default function SupervisorPairingModal({ onClose, pairedDeviceId, triggerHaptic }) {
    const [activeTab, setActiveTab] = useState('code'); // 'code' | 'devices'
    const [token, setToken] = useState('');
    const [timeLeft, setTimeLeft] = useState(0);
    const [loading, setLoading] = useState(false);
    const [copied, setCopied] = useState(false);

    // Estado para la lista de dispositivos (FASE 4)
    const [devices, setDevices] = useState([]);
    const [loadingDevices, setLoadingDevices] = useState(false);
    const [deviceToRevoke, setDeviceToRevoke] = useState(null);
    const [revoking, setRevoking] = useState(false);

    const canvasRef = useRef(null);
    const timerRef = useRef(null);

    const myDeviceId = typeof window !== 'undefined' ? (localStorage.getItem('dj_device_id') || '') : '';

    // 1. Generar token de 6 caracteres desde el backend
    const generateToken = async () => {
        if (!supabaseCloud) {
            showToast('Sin conexión a la nube', 'error');
            return;
        }

        triggerHaptic?.();
        setLoading(true);
        try {
            const requesterId = myDeviceId || pairedDeviceId;
            const { data, error } = await supabaseCloud.rpc('generate_monitor_token', {
                p_requester_id: requesterId
            });

            if (error) throw error;

            if (data && data.success && data.token) {
                setToken(data.token);
                setTimeLeft(600); // 10 minutos (600 segundos)
                showToast('Código de vinculación generado', 'success');
            } else {
                showToast(data?.message || 'No se pudo generar el código', 'error');
            }
        } catch (err) {
            console.error('[SupervisorPairingModal] Error al generar token:', err);
            showToast('Error al conectar con la nube', 'error');
        } finally {
            setLoading(false);
        }
    };

    // 2. Cargar dispositivos conectados (FASE 4 / FX6)
    const fetchDevices = async () => {
        if (!supabaseCloud || !pairedDeviceId) return;
        setLoadingDevices(true);
        try {
            const { data, error } = await supabaseCloud.rpc('list_monitors', {
                p_requester_id: myDeviceId || pairedDeviceId
            });

            if (!error && data && data.success) {
                setDevices(data.devices || []);
            } else {
                // Fallback si la RPC list_monitors aún no fue creada en la BD
                const { data: directData } = await supabaseCloud
                    .from('device_monitors')
                    .select('*')
                    .eq('primary_device_id', pairedDeviceId)
                    .is('revoked_at', null)
                    .order('paired_at', { ascending: true });
                setDevices(directData || []);
            }
        } catch (err) {
            console.warn('[SupervisorPairingModal] Error al cargar dispositivos:', err);
        } finally {
            setLoadingDevices(false);
        }
    };

    // 3. Revocar acceso a un dispositivo (FASE 4)
    const handleRevokeDevice = async () => {
        if (!deviceToRevoke || revoking) return;
        setRevoking(true);
        triggerHaptic?.();
        try {
            const { data, error } = await supabaseCloud.rpc('revoke_monitor', {
                p_requester_id: myDeviceId,
                p_target_monitor_id: deviceToRevoke.monitor_device_id
            });

            if (error) throw error;

            if (data && data.success) {
                showToast(`Acceso revocado para ${deviceToRevoke.device_label || 'el dispositivo'}`, 'success');
                setDeviceToRevoke(null);
                fetchDevices();
            } else {
                showToast(data?.message || 'No se pudo revocar el dispositivo', 'error');
            }
        } catch (err) {
            console.error('[SupervisorPairingModal] Error al revocar dispositivo:', err);
            showToast('Error al procesar la revocación', 'error');
        } finally {
            setRevoking(false);
        }
    };

    // Efecto para timer de expiración (10 min)
    useEffect(() => {
        if (timeLeft <= 0) return;
        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    clearInterval(timerRef.current);
                    setToken('');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(timerRef.current);
    }, [timeLeft > 0]);

    // Renderizar QR Code en Canvas (FX1: token plano)
    useEffect(() => {
        if (token && canvasRef.current && activeTab === 'code') {
            QRCode.toCanvas(canvasRef.current, token, {
                width: 200,
                margin: 2,
                color: {
                    dark: '#059669',
                    light: '#FFFFFF'
                }
            }, (err) => {
                if (err) console.error('[SupervisorPairingModal] Error al renderizar QR:', err);
            });
        }
    }, [token, activeTab]);

    // Generar token automáticamente al abrir la primera vez
    useEffect(() => {
        generateToken();
        fetchDevices();
    }, []);

    // Formatear el tiempo restante MM:SS
    const formatTimer = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    // Copiar código al portapapeles
    const handleCopy = () => {
        if (!token) return;
        navigator.clipboard.writeText(token);
        setCopied(true);
        showToast('Código copiado al portapapeles', 'success');
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col relative max-h-[90vh]" onClick={e => e.stopPropagation()}>
                
                {/* Modal Header */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/70 dark:bg-slate-800/40">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black">
                            <QrCode size={20} />
                        </div>
                        <div>
                            <h3 className="text-base font-black text-slate-800 dark:text-white leading-tight">
                                Vincular Dispositivos
                            </h3>
                            <p className="text-xs text-slate-400 font-medium">
                                Conecta otros teléfonos o tablets en modo supervisor
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs Navigator */}
                <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 px-4 pt-2 gap-2">
                    <button
                        onClick={() => { setActiveTab('code'); triggerHaptic?.(); }}
                        className={`flex-1 py-2.5 px-3 rounded-t-xl font-black text-xs flex items-center justify-center gap-2 border-b-2 transition-all ${
                            activeTab === 'code'
                                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900 shadow-xs'
                                : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                        }`}
                    >
                        <QrCode size={15} /> Código y QR
                    </button>
                    <button
                        onClick={() => { setActiveTab('devices'); fetchDevices(); triggerHaptic?.(); }}
                        className={`flex-1 py-2.5 px-3 rounded-t-xl font-black text-xs flex items-center justify-center gap-2 border-b-2 transition-all ${
                            activeTab === 'devices'
                                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-900 shadow-xs'
                                : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                        }`}
                    >
                        <Smartphone size={15} /> Dispositivos ({devices.length})
                    </button>
                </div>

                {/* Tab 1: Código y QR */}
                {activeTab === 'code' && (
                    <div className="p-6 space-y-6 overflow-y-auto">
                        {loading ? (
                            <div className="py-16 text-center space-y-3">
                                <RefreshCw size={28} className="mx-auto animate-spin text-emerald-500" />
                                <p className="text-xs font-bold text-slate-400">Generando código PIN de vinculación...</p>
                            </div>
                        ) : token ? (
                            <div className="flex flex-col items-center space-y-5">
                                {/* QR Code Container */}
                                <div className="p-3 bg-white border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm">
                                    <canvas ref={canvasRef} />
                                </div>

                                {/* PIN Code Display */}
                                <div className="w-full text-center space-y-2">
                                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Código Manual de 6 Caracteres</span>
                                    <div className="flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-800/80 p-3.5 rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
                                        <span className="font-outfit text-2xl font-black text-emerald-600 dark:text-emerald-400 tracking-widest uppercase">
                                            {token}
                                        </span>
                                        <button
                                            onClick={handleCopy}
                                            className="ml-2 p-2 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors shadow-2xs"
                                            title="Copiar Código"
                                        >
                                            {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                                        </button>
                                    </div>
                                </div>

                                {/* Timer & Action */}
                                <div className="flex items-center justify-between w-full pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                                    <div className="flex items-center gap-1.5 text-slate-500 font-bold">
                                        <Clock size={14} className="text-amber-500" />
                                        <span>Expira en: <strong className="font-outfit text-amber-600 dark:text-amber-400 font-black">{formatTimer(timeLeft)}</strong></span>
                                    </div>
                                    <button
                                        onClick={generateToken}
                                        className="py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors"
                                    >
                                        <RefreshCw size={13} /> Regenerar PIN
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="py-12 text-center space-y-4">
                                <AlertTriangle size={36} className="mx-auto text-amber-500" />
                                <div>
                                    <p className="text-xs font-black text-slate-700 dark:text-slate-200">El código de vinculación ha expirado</p>
                                    <p className="text-[11px] text-slate-400 mt-1">Genera un nuevo código para conectar un dispositivo.</p>
                                </div>
                                <button
                                    onClick={generateToken}
                                    className="py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs shadow-md transition-colors"
                                >
                                    Generar Nuevo Código
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* Tab 2: Lista de Dispositivos (FASE 4) */}
                {activeTab === 'devices' && (
                    <div className="p-6 space-y-4 overflow-y-auto max-h-[450px]">
                        {loadingDevices ? (
                            <div className="py-12 text-center space-y-3">
                                <RefreshCw size={24} className="mx-auto animate-spin text-emerald-500" />
                                <p className="text-xs font-bold text-slate-400">Cargando dispositivos vinculados...</p>
                            </div>
                        ) : devices.length === 0 ? (
                            <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                <Smartphone size={32} className="mx-auto mb-2 text-slate-350" />
                                <p className="text-xs font-black">No hay otros dispositivos vinculados</p>
                                <p className="text-[10px] text-slate-400 mt-1">Usa la pestaña "Código y QR" para conectar nuevos equipos.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {devices.map(dev => {
                                    const isSelf = dev.monitor_device_id === myDeviceId;
                                    const lastSeenDate = dev.last_seen_at ? new Date(dev.last_seen_at) : null;
                                    const isOnline = lastSeenDate && (Date.now() - lastSeenDate.getTime() <= 180000);

                                    return (
                                        <div
                                            key={dev.id || dev.monitor_device_id}
                                            className="p-3.5 border border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-3"
                                        >
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black shrink-0 ${
                                                    isOnline 
                                                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400' 
                                                        : 'bg-slate-200/60 dark:bg-slate-700/60 text-slate-400'
                                                }`}>
                                                    <Smartphone size={18} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h4 className="text-xs font-black text-slate-800 dark:text-white truncate">
                                                            {dev.device_label || 'Supervisor Remoto'}
                                                        </h4>
                                                        {isSelf && (
                                                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border border-blue-200/60">
                                                                Este dispositivo
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
                                                        <span className={`inline-block w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                                                        <span>{isOnline ? 'En línea' : 'Hace un momento'}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {!isSelf && (
                                                <button
                                                    onClick={() => setDeviceToRevoke(dev)}
                                                    className="p-2 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors shrink-0"
                                                    title="Revocar Acceso"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Modal de Confirmación de Revocación (Regla #15: Cero window.confirm) */}
                {deviceToRevoke && (
                    <div className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in zoom-in-95 duration-200">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl max-w-sm w-full text-center space-y-4">
                            <div className="w-14 h-14 rounded-2xl bg-rose-100 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
                                <ShieldAlert size={28} />
                            </div>
                            <div>
                                <h4 className="text-base font-black text-slate-800 dark:text-white">¿Desconectar Dispositivo?</h4>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed font-medium">
                                    Se revocará el acceso para <strong>{deviceToRevoke.device_label || 'este dispositivo'}</strong>. No podrá continuar viendo ni enviando comandos a la caja.
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    onClick={() => setDeviceToRevoke(null)}
                                    disabled={revoking}
                                    className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 rounded-2xl font-black text-xs transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={handleRevokeDevice}
                                    disabled={revoking}
                                    className="py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-2xl font-black text-xs transition-colors flex items-center justify-center gap-1.5 shadow-md"
                                >
                                    {revoking ? <RefreshCw size={14} className="animate-spin" /> : 'Revocar Acceso'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
