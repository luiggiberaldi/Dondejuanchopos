import React, { useState, useEffect } from 'react';
import { X, TrendingUp, DollarSign, Loader2 } from 'lucide-react';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from './Toast';

export default function SupervisorRateModal({ isOpen, onClose, rates, primaryDeviceId, triggerHaptic }) {
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
        
        // Validar tasa manual
        if (rateMode === 'manual') {
            const val = parseFloat(customRate);
            if (isNaN(val) || val <= 0) {
                showToast('Ingresa un valor de tasa válido mayor a 0', 'error');
                return;
            }
        }

        setLoading(true);
        try {
            const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
            
            // Insertar el comando en la base de datos de Supabase
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .insert({
                    primary_device_id: primaryDeviceId,
                    monitor_device_id: monitorDeviceId,
                    command_type: 'rate_change',
                    payload: {
                        rateMode,
                        customRate: rateMode === 'manual' ? parseFloat(customRate) : null
                    },
                    status: 'pending'
                });

            if (error) throw error;

            // Actualizar localmente también para consistencia visual del monitor
            localStorage.setItem('bodega_rate_mode', rateMode);
            localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode !== 'manual'));
            if (rateMode === 'manual') {
                localStorage.setItem('bodega_custom_rate', String(customRate));
            } else {
                // Limpiar la tasa manual vieja: si queda, el monitor la muestra
                // como referencia aunque el modo activo sea BCV/euro/paralelo
                localStorage.removeItem('bodega_custom_rate');
            }
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));

            showToast('¡Comando enviado a la caja con éxito!', 'success');
            onClose();
        } catch (err) {
            console.error('[SupervisorRateModal] Error al enviar comando:', err);
            showToast('Error al enviar comando: ' + (err.message || 'Error de conexión'), 'error');
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
