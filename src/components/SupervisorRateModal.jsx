import React, { useState, useEffect } from 'react';
import { X, TrendingUp, DollarSign, Loader2, Lock } from 'lucide-react';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from './Toast';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { createSupervisorCommandId, restoreLocalRateState, SUPERVISOR_RATE_PENDING_KEY } from '../utils/supervisorCommandModel';

const RATE_COMMAND_ACCEPTED_STATUSES = new Set(['pending', 'applied', 'applied_with_warnings']);
const RATE_COMMAND_TERMINAL_SUCCESS_STATUSES = new Set(['applied', 'applied_with_warnings']);

function isDefinitiveRateInsertFailure(error) {
    const status = Number(error?.status);
    if (Number.isFinite(status) && status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)) {
        return true;
    }
    return ['23514', '42501'].includes(String(error?.code || ''));
}

export default function SupervisorRateModal({ isOpen, onClose, rates, primaryDeviceId, triggerHaptic, onOpenBsWizard }) {
    const [rateMode, setRateMode] = useState('bcv'); // 'bcv', 'euro', 'usdt', 'manual'
    const [customRate, setCustomRate] = useState('');
    const [loading, setLoading] = useState(false);

    // Cargar valores actuales de la caja si existen en el storage local del monitor
    useEffect(() => {
        if (isOpen) {
            const savedMode = localStorage.getItem('bodega_rate_mode') || 'bcv';
            const savedCustom = localStorage.getItem('bodega_custom_rate') || '';
            setRateMode(savedMode);
            setCustomRate(savedCustom);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const bcvPrice = rates?.bcv?.price || 0;
    const euroPrice = rates?.euro?.price || 0;
    const usdtPrice = rates?.usdt?.price || 0;

    const handleApply = async () => {
        triggerHaptic?.();

        if (!supabaseCloud || !primaryDeviceId) {
            showToast('No hay una caja principal vinculada para recibir la tasa.', 'error');
            return;
        }
        
        // Validar tasa manual
        if (rateMode === 'manual') {
            const val = parseFloat(customRate);
            if (isNaN(val) || val <= 0) {
                showToast('Ingresa un valor de tasa válido mayor a 0', 'error');
                return;
            }
        }

        const pendingRaw = localStorage.getItem(SUPERVISOR_RATE_PENDING_KEY);
        if (pendingRaw) {
            showToast('La caja todavía está confirmando la tasa anterior. Espera su respuesta antes de enviar otra.', 'info');
            return;
        }

        setLoading(true);
        const commandId = createSupervisorCommandId();
        const activeUser = useAuthStore.getState().usuarioActivo;
        const previousRateState = {
            rateMode: localStorage.getItem('bodega_rate_mode'),
            useAutoRate: localStorage.getItem('bodega_use_auto_rate'),
            customRate: localStorage.getItem('bodega_custom_rate'),
        };
        const desiredRateState = {
            rateMode,
            useAutoRate: JSON.stringify(rateMode !== 'manual'),
            customRate: rateMode === 'manual' ? String(customRate) : null,
        };

        try {
            const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';

            // Optimistic UI: el Supervisor cambia de inmediato, pero conserva una
            // fotografía local para restaurar el valor si la caja rechaza el comando.
            localStorage.setItem('bodega_rate_mode', desiredRateState.rateMode);
            localStorage.setItem('bodega_use_auto_rate', desiredRateState.useAutoRate);
            if (desiredRateState.customRate === null) localStorage.removeItem('bodega_custom_rate');
            else localStorage.setItem('bodega_custom_rate', desiredRateState.customRate);
            localStorage.setItem(SUPERVISOR_RATE_PENDING_KEY, JSON.stringify({
                commandId,
                previous: previousRateState,
                desired: desiredRateState,
                issuedAt: new Date().toISOString(),
            }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));

            // El id se fija desde el primer intento. Si la respuesta se pierde,
            // un reintento no crea una segunda orden para la misma acción.
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .insert({
                    id: commandId,
                    primary_device_id: primaryDeviceId,
                    monitor_device_id: monitorDeviceId,
                    command_type: 'rate_change',
                    payload: {
                        commandId,
                        rateMode,
                        customRate: rateMode === 'manual' ? parseFloat(customRate) : null,
                        supervisorId: activeUser?.id || null,
                        supervisorName: activeUser?.nombre || activeUser?.usuario || 'Supervisor',
                        supervisorRole: activeUser?.rol || 'SUPERVISOR',
                    },
                    status: 'pending'
                });

            if (error) throw error;

            showToast('¡Comando enviado a la caja! Aplicación pendiente de confirmación.', 'success');
            onClose();
        } catch (err) {
            // Un timeout puede ocurrir DESPUÉS de que Supabase insertó la fila.
            // Consultar el commandId estable antes de restaurar evita que el usuario
            // reenvíe la misma orden y que la caja la procese dos veces.
            let remoteCommand = null;
            let lookupFailed = false;
            try {
                const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
                const { data, error: lookupError } = await supabaseCloud
                    .from('supervisor_commands')
                    .select('id,status,primary_device_id,monitor_device_id,error_reason')
                    .eq('id', commandId)
                    .maybeSingle();
                if (lookupError) lookupFailed = true;
                else if (data
                    && data.primary_device_id === primaryDeviceId
                    && data.monitor_device_id === monitorDeviceId) {
                    remoteCommand = data;
                }
            } catch {
                lookupFailed = true;
            }

            if (remoteCommand && RATE_COMMAND_ACCEPTED_STATUSES.has(remoteCommand.status)) {
                if (RATE_COMMAND_TERMINAL_SUCCESS_STATUSES.has(remoteCommand.status)) {
                    localStorage.removeItem(SUPERVISOR_RATE_PENDING_KEY);
                    showToast('La tasa ya fue recibida y aplicada por la caja.', 'success');
                } else {
                    showToast('La tasa quedó en espera en la nube; no la reenvíes. La caja la aplicará al conectarse.', 'warning');
                }
                onClose();
            } else if (lookupFailed && !isDefinitiveRateInsertFailure(err)) {
                // Estado de transporte ambiguo: conservar la proyección y el
                // recibo local para que el polling/realtime resuelva la orden.
                showToast('No se pudo confirmar el envío. La orden se conserva para evitar duplicarla.', 'warning');
                onClose();
            } else {
                restoreLocalRateState(previousRateState);
                localStorage.removeItem(SUPERVISOR_RATE_PENDING_KEY);
                console.error('[SupervisorRateModal] Error al enviar comando:', err);
                showToast('No se pudo enviar la tasa. Se restauró el valor anterior.', 'error');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col gap-5 text-slate-800 dark:text-slate-200">
                {/* Header */}
                <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-brand/10 text-brand dark:bg-slate-800 rounded-xl">
                            <TrendingUp size={18} />
                        </div>
                        <h3 className="font-black text-base text-slate-800 dark:text-white">Cambiar Tasa Remota</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed font-semibold">
                    Selecciona la tasa de cambio de referencia. Se aplicará a los cálculos de precios en bolívares (Bs) en la caja principal de forma inmediata.
                </p>

                {/* Opciones */}
                <div className="flex flex-col gap-2">
                    {/* Opción BCV */}
                    <button
                        onClick={() => { triggerHaptic?.(); setRateMode('bcv'); }}
                        className={`p-3.5 rounded-2xl border-2 text-left transition-all flex justify-between items-center active:scale-[0.99] ${
                            rateMode === 'bcv'
                                ? 'border-brand bg-brand-light/20 dark:bg-surface-800/10 text-brand dark:text-brand'
                                : 'border-slate-100 dark:border-slate-800 hover:border-slate-200'
                        }`}
                    >
                        <div className="flex flex-col">
                            <span className="text-xs font-black">Dólar BCV Oficial</span>
                            <span className="text-[10px] text-slate-400 font-medium">Tasa oficial del Banco Central</span>
                        </div>
                        <span className="text-sm font-black">{bcvPrice ? `${bcvPrice.toFixed(2)} Bs` : 'Cargando...'}</span>
                    </button>

                    {/* Opción Euro */}
                    <button
                        onClick={() => { triggerHaptic?.(); setRateMode('euro'); }}
                        className={`p-3.5 rounded-2xl border-2 text-left transition-all flex justify-between items-center active:scale-[0.99] ${
                            rateMode === 'euro'
                                ? 'border-brand bg-brand-light/20 dark:bg-surface-800/10 text-brand dark:text-brand'
                                : 'border-slate-100 dark:border-slate-800 hover:border-slate-200'
                        }`}
                    >
                        <div className="flex flex-col">
                            <span className="text-xs font-black">Euro BCV</span>
                            <span className="text-[10px] text-slate-400 font-medium">Tasa oficial de Euro BCV</span>
                        </div>
                        <span className="text-sm font-black">{euroPrice ? `${euroPrice.toFixed(2)} Bs` : 'Cargando...'}</span>
                    </button>

                    {/* Opción USDT */}
                    <button
                        onClick={() => { triggerHaptic?.(); setRateMode('usdt'); }}
                        className={`p-3.5 rounded-2xl border-2 text-left transition-all flex justify-between items-center active:scale-[0.99] ${
                            rateMode === 'usdt'
                                ? 'border-brand bg-brand-light/20 dark:bg-surface-800/10 text-brand dark:text-brand'
                                : 'border-slate-100 dark:border-slate-800 hover:border-slate-200'
                        }`}
                    >
                        <div className="flex flex-col">
                            <span className="text-xs font-black">Binance / Paralelo</span>
                            <span className="text-[10px] text-slate-400 font-medium">Tasa promedio de mercado</span>
                        </div>
                        <span className="text-sm font-black">{usdtPrice ? `${usdtPrice.toFixed(2)} Bs` : 'Cargando...'}</span>
                    </button>

                    {/* Opción Manual */}
                    <div
                        className={`p-3.5 rounded-2xl border-2 transition-all flex flex-col gap-3 ${
                            rateMode === 'manual'
                                ? 'border-brand bg-brand-light/20 dark:bg-surface-800/10'
                                : 'border-slate-100 dark:border-slate-800'
                        }`}
                        onClick={() => { if (rateMode !== 'manual') { triggerHaptic?.(); setRateMode('manual'); } }}
                    >
                        <div className="flex justify-between items-center">
                            <div className="flex flex-col">
                                <span className="text-xs font-black">Tasa Manual Personalizada</span>
                                <span className="text-[10px] text-slate-400 font-medium">Ingresa un valor específico</span>
                            </div>
                            {rateMode !== 'manual' && (
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Activar</span>
                            )}
                        </div>
                        {rateMode === 'manual' && (
                            <div className="relative">
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    placeholder="Ej. 45.50"
                                    value={customRate}
                                    onChange={(e) => setCustomRate(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded-xl py-2 px-3 text-sm font-black outline-none focus:border-brand transition-colors text-slate-800 dark:text-white"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">Bs/$</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Botón Revisar Precios en Bs Congelado */}
                {onOpenBsWizard && (
                    <button
                        type="button"
                        onClick={() => {
                            triggerHaptic?.();
                            onClose();
                            onOpenBsWizard();
                        }}
                        className="w-full py-3 px-4 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/30 font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                    >
                        <Lock size={16} className="text-amber-500" />
                        <span>Revisar Precios en Bs Congelado</span>
                    </button>
                )}

                {/* Footer */}
                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        disabled={loading}
                        className="flex-1 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all text-xs"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={loading}
                        className="flex-1 py-3 bg-[#193275] hover:bg-[#12265a] text-white font-bold rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-brand/20 text-xs"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="animate-spin" size={14} />
                                <span>Aplicando...</span>
                            </>
                        ) : (
                            <>
                                <DollarSign size={14} />
                                <span>Aplicar en Caja</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
