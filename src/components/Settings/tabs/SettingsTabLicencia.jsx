import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Hash, Copy, Check } from 'lucide-react';
import { SectionCard } from '../../SettingsShared';

export default function SettingsTabLicencia({ deviceId, triggerHaptic }) {
    const [idCopied, setIdCopied] = useState(false);

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text).then(() => {
            setIdCopied(true);
            triggerHaptic?.();
            setTimeout(() => setIdCopied(false), 2000);
        });
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {/* Estado de Licencia */}
            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={KeyRound} title="Licencia de Software" subtitle="Detalles de activación de la app" iconColor="text-brand">
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <span className="text-xs font-bold text-slate-500">Tipo de Licencia</span>
                            <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
                                Permanente
                            </span>
                        </div>

                        <div className="space-y-4">
                            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-2xl flex gap-3 items-start">
                                <ShieldCheck className="text-emerald-500 shrink-0 mt-0.5" size={20} />
                                <div>
                                    <h4 className="text-sm font-black text-emerald-800 dark:text-emerald-400">Licencia Activa Permanente</h4>
                                    <p className="text-xs text-emerald-700 dark:text-emerald-500 leading-normal mt-1">
                                        Disfrutas de acceso ilimitado a todas las herramientas premium del sistema Donde Juancho sin fecha de vencimiento.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </SectionCard>
            </div>

            {/* Datos Técnicos de Licencia */}
            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={Hash} title="Identificación del Equipo" subtitle="ID asociado para soporte técnico" iconColor="text-slate-500">
                    <div className="flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800 p-3 rounded-xl">
                        <div className="min-w-0">
                            <p className="text-[11px] uppercase tracking-wider font-extrabold text-slate-550 dark:text-slate-400 mb-1">ID de Instalación</p>
                            <p className="font-mono text-xs font-black text-slate-650 dark:text-slate-300 select-all truncate">{deviceId || '...'}</p>
                        </div>
                        <button
                            onClick={() => copyToClipboard(deviceId)}
                            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-all"
                            title="Copiar ID"
                        >
                            {idCopied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                        </button>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal mt-1">Este ID identifica de manera única a este navegador y equipo. Es útil para la vinculación P2P y backups.</p>
                </SectionCard>
            </div>
        </div>
    );
}
