import React from 'react';
import {
    TrendingUp, Users, LogOut, QrCode, MoreVertical, Download,
    RefreshCw, Wifi, WifiOff, Clock, Target, ShieldCheck
} from 'lucide-react';

/**
 * Header del Monitor de Supervisión (100% Responsivo):
 * logo, estado de conexión, acciones rápidas, banner offline y
 * navegación agrupada en dos niveles (grupos principales + sub-pestañas).
 */
export default function MonitorHeader({
    mainTabs,
    activeMainTabId,
    currentMainTab,
    viewTab,
    setViewTab,
    isConnected,
    lastSync,
    isPosOnline,
    posLastSeen,
    presenceError,
    syncLoading,
    downloadingBackup,
    totalControlChanges,
    triggerRefresh,
    triggerHaptic,
    showToast,
    showMobileMenu,
    setShowMobileMenu,
    setShowRateModal,
    setShowUsersModal,
    setShowPairingModal,
    setShowDisconnectConfirm,
    handleDownloadRemoteBackup,
    handleAutoRepairPairing,
    children,
}) {
    return (
        <>
            {/* Header del Monitor (100% Responsivo) */}
            <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-5 py-2.5 shadow-xs">
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                    {/* Fila Superior en Móvil / Izquierda en PC */}
                    <div className="flex items-center justify-between gap-3 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-2xl bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/20 text-white font-bold shrink-0">
                                <ShieldCheck size={18} className="sm:hidden" />
                                <ShieldCheck size={20} className="hidden sm:block" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-xs sm:text-base font-black leading-tight text-slate-800 dark:text-white truncate">Panel de Supervisión</h1>
                                <p className="text-[9px] sm:text-[10.5px] text-slate-400 font-medium truncate">Monitoreo en vivo • {localStorage.getItem('business_name') || 'Mi Negocio'}</p>
                            </div>
                        </div>

                        {/* Acciones Rápidas en Móvil: Refrescar + Menú ... */}
                        <div className="flex md:hidden items-center gap-1.5 shrink-0 relative">
                            <button
                                onClick={async () => {
                                    triggerHaptic?.();
                                    await triggerRefresh();
                                    showToast?.('Datos actualizados', 'success');
                                }}
                                disabled={syncLoading}
                                className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 transition-colors disabled:opacity-50 active:scale-95"
                                title="Actualizar Datos"
                            >
                                <RefreshCw size={15} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                            </button>

                            <button
                                onClick={() => { triggerHaptic?.(); setShowMobileMenu(!showMobileMenu); }}
                                className={`p-2 rounded-xl border transition-colors active:scale-95 ${
                                    showMobileMenu
                                        ? 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white'
                                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
                                }`}
                                title="Menú de Acciones"
                            >
                                <MoreVertical size={16} />
                            </button>

                            {/* Dropdown Menu para Acciones Secundarias en Móvil */}
                            {showMobileMenu && (
                                <>
                                    <div
                                        className="fixed inset-0 z-50"
                                        onClick={() => setShowMobileMenu(false)}
                                    />
                                    <div className="absolute right-0 top-11 z-50 w-56 bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-1.5 space-y-1 animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                            onClick={() => { triggerHaptic?.(); setShowMobileMenu(false); setShowRateModal(true); }}
                                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-left"
                                        >
                                            <TrendingUp size={15} className="text-amber-500 shrink-0" />
                                            <span>Cambiar Tasa Remota</span>
                                        </button>
                                        <button
                                            onClick={() => { triggerHaptic?.(); setShowMobileMenu(false); setShowUsersModal(true); }}
                                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-left"
                                        >
                                            <Users size={15} className="text-blue-500 shrink-0" />
                                            <span>Gestión de Usuarios / PINs</span>
                                        </button>
                                        <button
                                            onClick={() => { triggerHaptic?.(); setShowMobileMenu(false); setShowPairingModal(true); }}
                                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-left"
                                        >
                                            <QrCode size={15} className="text-emerald-500 shrink-0" />
                                            <span>Vincular Dispositivo</span>
                                        </button>
                                        <button
                                            onClick={() => { setShowMobileMenu(false); handleDownloadRemoteBackup(); }}
                                            disabled={downloadingBackup}
                                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-left disabled:opacity-50"
                                        >
                                            {downloadingBackup ? <RefreshCw size={15} className="text-cyan-500 animate-spin shrink-0" /> : <Download size={15} className="text-cyan-500 shrink-0" />}
                                            <span>{downloadingBackup ? 'Generando backup...' : 'Descargar backup de la caja'}</span>
                                        </button>
                                        <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
                                        <button
                                            onClick={() => { triggerHaptic?.(); setShowMobileMenu(false); setShowDisconnectConfirm(true); }}
                                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors text-left"
                                        >
                                            <LogOut size={15} className="shrink-0" />
                                            <span>Desvincular Dispositivo</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Status Badges y Acciones en PC */}
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 pb-0.5 md:pb-0">
                        {/* Status Badge del Supervisor */}
                        <div className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-xs shrink-0 transition-colors duration-300 ${
                            isConnected
                                ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-800/30 dark:text-emerald-400'
                                : 'bg-rose-50 border border-rose-200/50 text-rose-600 dark:bg-rose-950/20 dark:border-rose-800/30 dark:text-rose-400 animate-pulse'
                        }`}>
                            {isConnected ? (
                                <>
                                    <Wifi size={11} className="shrink-0" />
                                    <span>En Vivo</span>
                                </>
                            ) : (
                                <>
                                    <WifiOff size={11} className="shrink-0" />
                                    <span>Offline</span>
                                </>
                            )}
                        </div>

                        {/* Status Badge de la Caja Principal (Online/Offline) */}
                        <div
                            onClick={!isPosOnline ? handleAutoRepairPairing : undefined}
                            title={isPosOnline
                                ? `Caja conectada (${posLastSeen ? posLastSeen.toLocaleTimeString() : ''})`
                                : presenceError
                                    ? `No se pudo verificar la presencia: ${presenceError}`
                                    : 'Haz clic para verificar vínculo con la caja'}
                            className={`flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-xs shrink-0 transition-all duration-300 ${
                                !isPosOnline ? 'cursor-pointer bg-amber-500 text-white border border-amber-600 active:scale-95 shadow-tone-sm' : 'bg-emerald-50 border border-emerald-200/60 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800/50 dark:text-emerald-400'
                            }`}
                        >
                            <span className={`w-2 h-2 rounded-full shrink-0 ${isPosOnline ? 'bg-emerald-500 animate-pulse' : 'bg-white'}`} />
                            <span>{isPosOnline ? 'Caja: En Línea' : presenceError ? 'Caja: Sin verificar' : 'Caja: Offline'}</span>
                            {!isPosOnline && <Target size={11} className="text-white animate-pulse ml-0.5" />}
                        </div>



                        {/* Botones de Acción en PC */}
                        <div className="hidden md:flex items-center gap-1.5 ml-2 border-l border-slate-200 dark:border-slate-800 pl-2 shrink-0">
                            <button
                                onClick={async () => {
                                    triggerHaptic?.();
                                    await triggerRefresh();
                                    showToast?.('Datos actualizados', 'success');
                                }}
                                disabled={syncLoading}
                                className="p-2 rounded-xl text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-emerald-400 transition-colors disabled:opacity-50 cursor-pointer"
                                title="Actualizar Datos"
                            >
                                <RefreshCw size={15} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                            </button>

                            <button
                                onClick={() => { triggerHaptic?.(); setShowRateModal(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-brand hover:bg-brand-light border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-brand transition-colors cursor-pointer"
                                title="Cambiar Tasa Remota"
                            >
                                <TrendingUp size={15} />
                            </button>

                            <button
                                onClick={() => { triggerHaptic?.(); setShowUsersModal(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-blue-400 transition-colors flex items-center gap-1.5 cursor-pointer"
                                title="Gestión de Usuarios, Roles y PINs"
                            >
                                <Users size={15} />
                                <span className="hidden lg:inline text-xs font-black text-slate-600 dark:text-slate-300">Usuarios</span>
                            </button>

                            <button
                                onClick={() => { triggerHaptic?.(); setShowPairingModal(true); }}
                                className="px-2.5 py-2 rounded-xl text-emerald-600 dark:text-emerald-400 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800/60 dark:bg-emerald-950/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                                title="Vincular Celular u otro equipo Supervisor"
                            >
                                <QrCode size={15} />
                                <span className="hidden lg:inline text-xs font-black text-emerald-700 dark:text-emerald-300">+ Vincular Celular</span>
                            </button>

                            <button
                                onClick={handleDownloadRemoteBackup}
                                disabled={downloadingBackup}
                                className="p-2 rounded-xl text-cyan-500 hover:text-cyan-700 hover:bg-cyan-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-cyan-400 transition-colors disabled:opacity-50 cursor-pointer"
                                title="Descargar backup de la caja"
                            >
                                {downloadingBackup ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
                            </button>

                            <button
                                onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(true); }}
                                className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-rose-400 transition-colors cursor-pointer"
                                title="Desvincular Dispositivo"
                            >
                                <LogOut size={15} />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Banner Offline */}
            {!isConnected && lastSync && (
                <div className="mx-4 mt-4 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl flex gap-3 items-center text-amber-800 dark:text-amber-400 shadow-sm animate-fade-in">
                    <Clock size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        Sin conexión a internet. Mostrando últimos datos sincronizados el {lastSync.toLocaleDateString()} a las {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                </div>
            )}

            {/* Contenido Principal */}
            <main className="max-w-7xl mx-auto px-4 mt-6 space-y-6">
                {/* ── SELECTOR DE NAVEGACIÓN AGRUPADA (NIVEL 1: 4 GRUPOS PRINCIPALES + NIVEL 2: SUB-PESTAÑAS) ── */}
                <div className="space-y-2.5">
                    {/* Nivel 1: 4 Grupos Principales (100% Responsivo en Móvil y Desktop) */}
                    <div className="bg-slate-200/70 dark:bg-slate-900/80 p-1.5 rounded-2xl sm:rounded-3xl w-full shadow-xs border border-slate-300/40 dark:border-slate-800">
                        <div className="grid grid-cols-4 gap-1 sm:gap-2 w-full">
                            {mainTabs.map(main => {
                                const Icon = main.icon;
                                const isActive = activeMainTabId === main.id;
                                const showBadge = main.hasBadge && totalControlChanges > 0;

                                return (
                                    <button
                                        key={main.id}
                                        onClick={() => {
                                            triggerHaptic?.();
                                            if (!isActive) {
                                                setViewTab(main.defaultSubTab);
                                            }
                                        }}
                                        className={`relative py-2 sm:py-2.5 px-1 sm:px-3 text-center font-black rounded-xl sm:rounded-2xl transition-all flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 cursor-pointer ${
                                            isActive
                                                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                                                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/40 dark:hover:bg-slate-850'
                                        }`}
                                    >
                                        <Icon size={16} className={`shrink-0 ${isActive ? 'text-brand' : 'text-slate-400 dark:text-slate-500'}`} />
                                        <span className="text-[11px] sm:text-xs tracking-tight font-black">{main.label}</span>
                                        {showBadge && (
                                            <span className="absolute -top-1 -right-1 sm:static px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[8px] sm:text-[9px] font-black tabular-nums animate-pulse shadow-xs">
                                                {totalControlChanges}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Nivel 2: Sub-pestañas del grupo activo (Perfectamente distribuidas en móvil y PC) */}
                    {currentMainTab.subTabs.length > 1 && (
                        <div className={`grid ${
                            currentMainTab.subTabs.length === 2
                                ? 'grid-cols-2'
                                : currentMainTab.subTabs.length === 3
                                ? 'grid-cols-3'
                                : 'grid-cols-4'
                        } gap-1.5 w-full py-0.5 px-0.5 animate-fade-in`}>
                            {currentMainTab.subTabs.map(sub => {
                                const SubIcon = sub.icon;
                                const isSubActive = viewTab === sub.id;

                                return (
                                    <button
                                        key={sub.id}
                                        onClick={() => {
                                            triggerHaptic?.();
                                            setViewTab(sub.id);
                                        }}
                                        className={`min-h-[38px] px-1 sm:px-4 py-2 rounded-xl text-[10.5px] sm:text-xs font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer w-full text-center ${
                                            isSubActive
                                                ? 'bg-brand text-white shadow-sm shadow-brand/25 ring-1 ring-brand'
                                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/70 dark:border-slate-800'
                                        }`}
                                    >
                                        <SubIcon size={13} className={`shrink-0 ${isSubActive ? 'text-white' : 'text-slate-400'}`} />
                                        <span className="sm:hidden font-black truncate">{sub.shortLabel || sub.label}</span>
                                        <span className="hidden sm:inline truncate">{sub.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Contenido de la pestaña activa */}
                {children}
            </main>
        </>
    );
}
