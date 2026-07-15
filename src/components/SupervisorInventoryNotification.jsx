import React, { useState, useEffect } from 'react';
import { Sparkles, X, PackageCheck } from 'lucide-react';
import { soundService } from '../utils/soundService';

// Banner en la CAJA cuando el supervisor modifica el inventario de forma remota.
// Clon del patrón de SupervisorRateNotification: CustomEvent + sonido + cierre por tap.
const ACTION_LABELS = {
    add: 'agregó',
    edit: 'editó',
    delete: 'eliminó',
    adjust_stock: 'ajustó el stock de',
};

export default function SupervisorInventoryNotification() {
    const [visible, setVisible] = useState(false);
    const [info, setInfo] = useState({ action: '', productName: '' });

    useEffect(() => {
        const handleApplied = (e) => {
            const { action, productName } = e.detail || {};
            setInfo({ action, productName });
            setVisible(true);

            soundService.playAlert();
            try {
                if (navigator.vibrate) {
                    navigator.vibrate([150, 100, 150]);
                }
            } catch (err) { /* vibración no soportada */ }
        };

        window.addEventListener('supervisor_inventory_applied', handleApplied);
        return () => {
            window.removeEventListener('supervisor_inventory_applied', handleApplied);
        };
    }, []);

    if (!visible) return null;

    const verb = ACTION_LABELS[info.action] || 'modificó';

    return (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[400] w-full max-w-sm px-4 animate-in fade-in slide-in-from-top-6 duration-300 pointer-events-auto">
            <div
                onPointerDown={() => setVisible(false)}
                className="bg-[#193275] dark:bg-slate-900 border border-white/10 text-white rounded-3xl p-4 shadow-2xl flex items-start gap-3 backdrop-blur-md relative overflow-hidden group cursor-pointer hover:scale-[1.02] active:scale-[0.98] transition-all"
                title="Toca en cualquier parte para cerrar"
            >
                <div className="absolute -top-12 -right-12 w-24 h-24 bg-cyan-500/10 rounded-full blur-xl group-hover:bg-cyan-500/20 transition-all duration-500" />

                <div className="p-2.5 bg-cyan-500/20 dark:bg-cyan-500/10 text-cyan-400 rounded-2xl shrink-0">
                    <PackageCheck size={20} className="animate-pulse" />
                </div>

                <div className="flex-1 space-y-1">
                    <p className="text-xs font-black uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                        <Sparkles size={12} />
                        Inventario Actualizado
                    </p>
                    <h4 className="text-sm font-black tracking-tight leading-tight">
                        Cambio remoto del Supervisor
                    </h4>
                    <p className="text-[11px] text-slate-300 font-medium">
                        El supervisor {verb}{' '}
                        <span className="font-bold text-white">«{info.productName || 'un producto'}»</span>
                    </p>
                </div>

                <div className="p-1 rounded-xl text-slate-400 group-hover:text-white transition-colors">
                    <X size={16} />
                </div>
            </div>
        </div>
    );
}
