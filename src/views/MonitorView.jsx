import React, { useState, useRef } from 'react';
import { showToast } from '../components/Toast';
import { RefreshCw, TrendingUp, TrendingDown, WifiOff, Clock, Maximize, Minimize, Camera, Loader2, AlertTriangle, Sun, Moon } from 'lucide-react';
import html2canvas from 'html2canvas';

export default function MonitorView({ rates: propRates, loading, isOffline, onRefresh, toggleTheme, theme, copyLogs, addLog, triggerHaptic, onClose }) {

    const rates = {
        bcv: { price: 0, change: 0, source: 'BCV Oficial', ...propRates?.bcv },
        euro: { price: 0, change: 0, source: 'Euro BCV', ...propRates?.euro },
        usdt: { price: 0, change: 0, source: 'Paralelo / Binance', ...propRates?.usdt },
        lastUpdate: propRates?.lastUpdate ?? null
    };

    const [secretCount, setSecretCount] = useState(0);
    const [kioskMode, setKioskMode] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);

    // Referencia al contenedor del Kiosco (para la foto)
    const kioskRef = useRef(null);

    // Detección de Datos Viejos (> 4 Horas)
    const isOldData = (() => {
        if (!rates || !rates.lastUpdate) return false;
        const diff = new Date() - new Date(rates.lastUpdate);
        return diff > 4 * 60 * 60 * 1000; // 4 Hours
    })();

    // SEC-023: el "debug secreto" (7 clics en el logo para copiar logs) solo
    // está disponible en desarrollo. En producción el handler se vuelve no-op
    // para evitar que cualquier usuario final (o atacante con acceso físico)
    // acceda a logs internos o datos de diagnóstico.
    const handleSecretDebug = () => {
        if (!import.meta.env.DEV) return;
        triggerHaptic && triggerHaptic();
        const newCount = secretCount + 1;
        setSecretCount(newCount);
        if (newCount === 7) {
            copyLogs && copyLogs();
            setSecretCount(0);
        }
        if (newCount === 1) setTimeout(() => setSecretCount(0), 2000);
    };

    const formatVES = (amount) => {
        return new Intl.NumberFormat('es-VE', { maximumFractionDigits: 0 }).format(Math.ceil(amount));
    };

    // Formato exacto para tasas (2 decimales, sin redondeo hacia arriba)
    const formatExactRate = (amount) => {
        return new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    };

    // Cálculos matemáticos
    const spread = rates.usdt.price > 0 && rates.bcv.price > 0 ? ((rates.usdt.price - rates.bcv.price) / rates.bcv.price) * 100 : 0;
    const diffBs = rates.usdt.price - rates.bcv.price;

    const renderPremiumChange = (change) => {
        if (change === undefined || change === null) return null;
        const isPositive = change > 0;
        const isZero = change === 0;
        
        if (isZero) {
            return (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-white/5 bg-white/5 text-slate-400 font-outfit flex items-center gap-1">
                    0.00%
                </span>
            );
        }
        
        return (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border font-outfit flex items-center gap-1 ${
                isPositive 
                    ? 'bg-[#00E5A0]/10 text-[#00E5A0] border-[#00E5A0]/20' 
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
            }`}>
                {isPositive ? <TrendingUp size={10} className="stroke-[2.5]" /> : <TrendingDown size={10} className="stroke-[2.5]" />}
                {isPositive ? '+' : ''}{change.toFixed(2)}%
            </span>
        );
    };

    // 📸 FUNCIÓN DE CAPTURA (Estable y Rápida)
    const handleCaptureKiosk = async () => {
        triggerHaptic && triggerHaptic();
        if (!kioskRef.current || isCapturing) return;
        setIsCapturing(true);
        const log = addLog || console.log;

        try {
            // 1. Capturamos el elemento visual (KioskRef)
            const canvas = await html2canvas(kioskRef.current, {
                useCORS: true,
                scale: window.devicePixelRatio, // Usa la calidad nativa del teléfono
                backgroundColor: '#080E1C',     // Fondo oscuro forzado
                ignoreElements: (element) => element.hasAttribute('data-hide-on-capture'),
            });

            // 2. Generamos la imagen JPEG (Más ligera y compatible)
            const image = canvas.toDataURL("image/jpeg", 0.9);

            // 3. Descarga automática
            const link = document.createElement('a');
            const dateStr = new Date().toLocaleDateString('es-VE').replace(/\//g, '-');
            const timeStr = new Date().toLocaleTimeString('es-VE', { hour12: false }).replace(/:/g, '');

            link.download = `PreciosAlDía_${dateStr}_${timeStr}.jpg`;
            link.href = image;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            log("Captura guardada con éxito", "success");

        } catch (e) {
            console.error("Error captura:", e);
            showToast('Hubo un error al guardar la imagen', 'error');
        } finally {
            setIsCapturing(false);
        }
    };

    // --- MODO KIOSCO (Pantalla Completa) ---
    if (kioskMode) {
        const priceStr = formatExactRate(rates.bcv.price);
        const [integers, decimals] = priceStr.split(',');

        return (
            <div
                ref={kioskRef}
                className="fixed inset-0 z-[100] bg-slate-50 text-slate-900 flex flex-col justify-between items-center p-6 animate-in zoom-in duration-300 overflow-hidden"
            >
                <style>{`
                  .font-outfit { font-family: 'Outfit', sans-serif; }
                  .font-dm-mono { font-family: 'DM Mono', monospace; }
                `}</style>
                
                {/* Glow de fondo suave */}
                <div className="bg-gradient-to-tr from-emerald-100/60 via-transparent to-teal-50/80 blur-[120px] pointer-events-none absolute inset-0"></div>

                {/* Botón Salir */}
                <button
                    data-hide-on-capture
                    onClick={() => { triggerHaptic && triggerHaptic(); setKioskMode(false); }}
                    className="absolute top-6 right-6 p-3 bg-slate-100 border border-slate-200 rounded-full text-slate-500 hover:text-slate-800 transition-colors z-20 active:scale-95 shadow-sm"
                >
                    <Minimize size={24} />
                </button>

                {/* Encabezado Kiosco */}
                <div className="flex flex-col items-center mt-12 gap-4 relative z-10">
                    <img src="/logo.png" alt="PreciosAlDía" className="h-20 w-auto object-contain drop-shadow-sm" />
                    <div className="bg-white/80 px-4 py-1.5 rounded-full border border-slate-200 backdrop-blur-md shadow-sm">
                        <p className="text-[10px] font-bold text-slate-500 tracking-[0.25em] uppercase font-outfit">MONITOR EN TIEMPO REAL</p>
                    </div>
                </div>

                {/* PRECIO GIGANTE */}
                <div className="flex flex-col items-center justify-center -mt-8 relative z-10">
                    <div className="flex items-baseline font-dm-mono select-none">
                        <span className="text-4xl sm:text-5xl text-slate-400 font-bold self-start mt-2 mr-3">$</span>
                        <h1 className="text-[16vw] sm:text-[9rem] font-bold leading-none tracking-tighter text-slate-900">
                            {integers}
                        </h1>
                        <span className="text-5xl sm:text-7xl font-bold text-emerald-500 leading-none">
                            ,{decimals}
                        </span>
                        <span className="text-2xl sm:text-3xl font-bold text-slate-400 ml-4">Bs</span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 font-dm-mono tracking-widest mt-4 uppercase">Valor del Dólar BCV Oficial</p>
                </div>

                {/* Tarjetas Informativas */}
                <div 
                    className="w-full max-w-md rounded-[2.5rem] border border-slate-200 p-6 sm:p-8 flex justify-between items-center mb-8 relative z-10 shadow-sm"
                    style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(10px)' }}
                >
                    <div className="text-center flex-1 border-r border-slate-200 pr-4">
                        <p className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 font-outfit">BCV DÓLAR</p>
                        <p className="text-2xl sm:text-3xl font-dm-mono font-bold text-slate-900">{formatExactRate(rates.bcv.price)}</p>
                    </div>
                    {rates.usdt.price > 0 && (
                        <div className="text-center flex-1 border-r border-slate-200 px-4">
                            <p className="text-xs font-bold uppercase text-amber-600 tracking-wider mb-2 font-outfit">USDT</p>
                            <p className="text-2xl sm:text-3xl font-dm-mono font-bold text-slate-900">{formatExactRate(rates.usdt.price)}</p>
                        </div>
                    )}
                    <div className="text-center flex-1 pl-4">
                        <p className="text-xs font-bold uppercase text-slate-500 tracking-wider mb-2 font-outfit">BCV EURO</p>
                        <p className="text-2xl sm:text-3xl font-dm-mono font-bold text-slate-900">{formatExactRate(rates.euro.price)}</p>
                    </div>
                </div>

                {/* Pie de página + Botón Captura */}
                <div className="flex flex-col items-center gap-6 mb-8 w-full relative z-10">
                    <div className="text-center">
                        <p className="text-lg font-bold text-emerald-600 font-outfit">
                            {rates.lastUpdate ? new Date(rates.lastUpdate).toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' }) : '---'}
                        </p>
                        <p className="text-sm font-dm-mono text-slate-500 mt-1">
                            Actualizado: {rates.lastUpdate ? new Date(rates.lastUpdate).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--'}
                        </p>
                    </div>

                    {/* BOTÓN FLOTANTE PARA CAPTURAR (Se oculta al tomar la foto) */}
                    {!isCapturing && (
                        <button
                            data-hide-on-capture
                            onClick={handleCaptureKiosk}
                            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-6 py-3 rounded-full font-bold shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform font-outfit text-sm"
                        >
                            {isCapturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                            <span>Compartir Monitor</span>
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // --- SKELETON LOADING (Carga inicial) ---
    if (loading && (!rates || !rates.bcv || rates.bcv.price === 0)) {
        return (
            <div className="h-[calc(100dvh-150px)] bg-slate-50 flex flex-col justify-between py-6 px-4 animate-pulse relative overflow-hidden">
                <style>{`
                  .font-outfit { font-family: 'Outfit', sans-serif; }
                  .font-dm-mono { font-family: 'DM Mono', monospace; }
                `}</style>
                
                {/* Glow de fondo suave */}
                <div className="bg-gradient-to-tr from-emerald-100/40 via-transparent to-teal-50/60 blur-[120px] pointer-events-none absolute inset-0"></div>

                <div className="flex justify-between items-center mb-8 px-2 relative z-10">
                    <div className="h-12 w-36 bg-slate-200 border border-slate-300 rounded-2xl"></div>
                    <div className="flex gap-2">
                        <div className="h-10 w-10 bg-slate-200 border border-slate-300 rounded-xl"></div>
                        <div className="h-10 w-10 bg-slate-200 border border-slate-300 rounded-xl"></div>
                    </div>
                </div>
                
                <div className="flex-1 flex flex-col justify-center gap-6 min-h-0 relative z-10">
                    <div className="h-72 bg-slate-200 border border-slate-300 rounded-[2.5rem]"></div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="h-36 bg-slate-200 border border-slate-300 rounded-[2rem]"></div>
                        <div className="h-36 bg-slate-200 border border-slate-300 rounded-[2rem]"></div>
                    </div>
                </div>
                
                <div className="h-10 w-48 bg-slate-200 border border-slate-300 rounded-full mx-auto mt-6"></div>
            </div>
        );
    }

    const priceStr = formatExactRate(rates.bcv.price);
    const [integers, decimals] = priceStr.split(',');

    // --- VISTA NORMAL (GRID PRINCIPAL) ---
    return (
        <div className="flex flex-col h-[100dvh] justify-between py-2 relative bg-slate-50 px-3 sm:px-4">
            <style>{`
              .font-outfit { font-family: 'Outfit', sans-serif; }
              .font-dm-mono { font-family: 'DM Mono', monospace; }
              .glass-panel {
                background: rgba(255, 255, 255, 0.75);
                border: 1px solid rgba(0, 0, 0, 0.08);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                box-shadow: 0 2px 20px rgba(0,0,0,0.06);
              }
              .glass-card-hover {
                transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
              }
              .glass-card-hover:hover {
                transform: translateY(-4px);
                background: rgba(255, 255, 255, 0.9);
                border-color: rgba(16, 185, 129, 0.3);
                box-shadow: 0 12px 40px -12px rgba(16, 185, 129, 0.15);
              }
            `}</style>

            {/* Gradiente de fondo claro */}
            <div className="bg-gradient-to-tr from-emerald-100/50 via-transparent to-teal-50/60 blur-[120px] pointer-events-none absolute inset-0"></div>

            {/* HEADER */}
            <header className="flex items-center justify-between pt-[env(safe-area-inset-top)] pb-2 px-1 shrink-0 relative z-10" style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)' }}>
                <div className="flex flex-col items-start gap-0.5">
                    <button onClick={handleSecretDebug} className="active:scale-95 transition-transform outline-none">
                        <img src="/logo.png" alt="PreciosAlDía" className="h-14 sm:h-16 w-auto object-contain drop-shadow-sm" />
                    </button>
                    <div className="flex items-center gap-1.5 pl-3">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.18em] leading-none font-outfit">Bodegas</span>
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); toggleTheme(); }}
                            className="text-slate-400 hover:text-slate-700 transition-colors active:scale-90 outline-none"
                            title="Alternar tema de la aplicación"
                        >
                            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Indicador LIVE o OFFLINE */}
                    {isOffline ? (
                        <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-full shrink-0">
                            <WifiOff size={11} className="text-rose-500" />
                            <span className="text-[9px] font-bold text-rose-600 tracking-wider uppercase font-outfit">OFFLINE</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-full shrink-0">
                            <span className="relative flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                            </span>
                            <span className="text-[9px] font-bold text-emerald-700 tracking-wider uppercase font-outfit">LIVE</span>
                        </div>
                    )}

                    {/* BOTÓN MODO KIOSCO */}
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); setKioskMode(true); }}
                        className="p-2 sm:p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                        title="Pantalla Completa / Captura"
                    >
                        <Maximize size={18} strokeWidth={2} />
                    </button>

                    {/* BOTÓN REFRESH */}
                    <button 
                        onClick={() => { triggerHaptic && triggerHaptic(); onRefresh(); }} 
                        disabled={loading} 
                        className={`p-2 sm:p-2.5 rounded-2xl shadow-sm border transition-all active:scale-95 ${
                            loading 
                                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed' 
                                : 'bg-emerald-500 hover:bg-emerald-600 text-white border-transparent shadow-emerald-200'
                        }`}
                        title="Actualizar tasas"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} strokeWidth={2.5} />
                    </button>

                    {/* BOTÓN VOLVER (CERRAR OVERLAY) */}
                    {onClose && (
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); onClose(); }}
                            className="p-2 sm:p-2.5 rounded-2xl bg-white border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-all shadow-sm active:scale-95"
                            title="Volver al inicio"
                        >
                            <Minimize size={18} strokeWidth={2} />
                        </button>
                    )}
                </div>
            </header>

            {/* Warning de Datos Viejos */}
            {isOldData && (
                <div className="mx-1 px-4 py-2.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center gap-2 animate-in slide-in-from-top-2 shrink-0 relative z-10">
                    <AlertTriangle size={14} className="text-amber-400" />
                    <p className="text-xs font-bold text-amber-400 font-outfit">
                        Precios referenciales (No actualizados hoy)
                    </p>
                </div>
            )}

            {/* CONTENEDOR TARJETAS (FLEX-1 PARA OCUPAR ESPACIO Y CENTRAR) */}
            <div className="flex-1 flex flex-col justify-center gap-4 min-h-0 relative z-10 py-4">

                {/* Tarjeta Principal BCV Hero */}
                <div className="relative group shrink-0">
                    {/* Sombra sutil bajo la tarjeta */}
                    <div className="absolute -inset-0.5 bg-emerald-400/20 rounded-[2.2rem] blur-xl opacity-30 group-hover:opacity-50 transition duration-500"></div>
                    
                    <div className="glass-panel rounded-[2rem] p-6 overflow-hidden relative">
                        {/* Marca de agua de fondo */}
                        <div className="absolute top-0 right-0 p-8 opacity-[0.03] transform rotate-12 pointer-events-none text-slate-900">
                            <TrendingUp size={140} />
                        </div>

                        <div className="flex justify-between items-start mb-4">
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-outfit">TASA OFICIAL DE REFERENCIA</span>
                                <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2 font-outfit">
                                    Dólar BCV
                                </h2>
                            </div>
                            {renderPremiumChange(rates.bcv.change)}
                        </div>

                        <div className="flex items-baseline select-none mb-5 font-dm-mono">
                            <span className="text-3xl text-slate-400 font-bold self-start mt-2 mr-2">$</span>
                            <div className="text-[12vw] sm:text-[5rem] lg:text-[4rem] xl:text-[5rem] leading-none font-bold text-slate-900 tracking-tighter">
                                {integers}
                                <span className="text-3xl sm:text-4xl text-emerald-500">,{decimals}</span>
                            </div>
                            <span className="text-xl font-bold text-slate-500 ml-2.5">Bs</span>
                        </div>

                        {/* Fila de Spread */}
                        <div className="flex items-center justify-between text-[11px] border-t border-slate-200 pt-4 font-outfit">
                            <span className="text-slate-600 font-medium">Diferencial USDT-Dólar (Spread)</span>
                            <span className="font-dm-mono text-slate-800 font-bold bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                                {spread.toFixed(2)}% (+{formatExactRate(diffBs)} Bs)
                            </span>
                        </div>
                    </div>
                </div>

                {/* Tarjetas Secundarias (USDT / Euro) */}
                <div className="grid grid-cols-2 gap-4 shrink-0">
                    <RateCardMini title="USDT" price={rates.usdt.price} change={rates.usdt.change} icon="₮" formatVES={formatExactRate} renderChange={renderPremiumChange} symbol="Bs / USDT" accent />
                    <RateCardMini title="Euro BCV Oficial" price={rates.euro.price} change={rates.euro.change} icon="🇪🇺" formatVES={formatExactRate} renderChange={renderPremiumChange} symbol="Bs / €" />
                </div>
            </div>

            {/* Footer Clock */}
            <div className="flex justify-center mt-auto pb-2 shrink-0 relative z-10">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm">
                    <Clock size={12} className="text-emerald-500" />
                    <span className="text-[10px] font-dm-mono font-medium text-slate-600">
                        Actualizado: {rates.lastUpdate ? new Date(rates.lastUpdate).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true }) : '--:--'}
                    </span>
                </div>
            </div>
        </div>
    );
}

// Componente pequeño para tarjetas secundarias
function RateCardMini({ title, price, change, icon, formatVES, renderChange, symbol, accent }) {
    return (
        <div className={`glass-panel p-5 rounded-[1.8rem] transition-all duration-300 ${
            accent 
                ? 'hover:border-amber-300 hover:shadow-[0_12px_40px_-12px_rgba(251,191,36,0.15)]'
                : 'hover:border-emerald-300 hover:shadow-[0_12px_40px_-12px_rgba(16,185,129,0.15)]'
        }`}>
            <div className="flex justify-between items-start mb-4">
                <span className="text-xl filter drop-shadow-sm">{icon}</span>
                {change !== 0 ? renderChange(change) : <div className="h-5"></div>}
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider block mb-1 font-outfit ${
                price > 0 ? 'text-slate-600' : 'text-slate-400'
            }`}>{title}</span>
            <div className={`text-xl font-bold tracking-tight font-dm-mono ${
                price > 0 ? 'text-slate-900' : 'text-slate-400'
            }`}>
                {price > 0 ? formatVES(price) : <span className="text-base">Sin dato</span>}
            </div>
            <div className="text-[10px] text-slate-500 font-medium font-outfit mt-0.5">{symbol || 'Bs / $'}</div>
        </div>
    );
}
