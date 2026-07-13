import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, AlertTriangle, Package, Tag, Scale, ChevronDown, ChevronUp, Barcode, Banknote, CheckCircle } from 'lucide-react';
import CustomSelect from '../CustomSelect';

export default function ProductFormQuick({
    image, setImage,
    name, setName,
    barcode, setBarcode,
    category, setCategory,
    priceUsd, handlePriceUsdChange,
    priceBsManual, setPriceBsManual,
    costUsd, handleCostUsdChange,
    costBs, handleCostBsChange,
    stock, setStock,
    lowStockAlert, setLowStockAlert,

    sellByBox, setSellByBox,
    boxUnits, setBoxUnits,
    boxBarcode, setBoxBarcode,
    boxPriceUsd, setBoxPriceUsd,
    boxPriceBs, setBoxPriceBs,

    sellByHalfBox, setSellByHalfBox,
    halfBoxUnits, setHalfBoxUnits,
    halfBoxBarcode, setHalfBoxBarcode,
    halfBoxPriceUsd, setHalfBoxPriceUsd,
    halfBoxPriceBs, setHalfBoxPriceBs,

    effectiveRate,
    handleImageUpload,
    categories
}) {
    const fileInputRef = useRef(null);
    const [showSummary, setShowSummary] = useState(false);

    // Auto-calcular sugerencia de unidades para 1/2 caja cuando cambian las de la caja
    useEffect(() => {
        if (sellByHalfBox && !halfBoxUnits && boxUnits) {
            const calculated = Math.floor(parseInt(boxUnits, 10) / 2);
            if (calculated > 0) {
                setHalfBoxUnits(calculated.toString());
            }
        }
    }, [boxUnits, sellByHalfBox]);

    const parsedPrice = Number(priceUsd) || 0;
    const parsedCost = Number(costUsd) || 0;

    // Calcular margen de ganancia de la unidad
    const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
    const mainMarginUsd = parsedPrice - parsedCost;

    return (
        <div className="space-y-5">
            {/* Foto del Producto (Ancho completo) */}
            <div className="select-none">
                <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Foto del Producto</label>
                <div 
                    onClick={() => fileInputRef.current?.click()} 
                    className="w-full h-32 bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors relative overflow-hidden"
                >
                    {image ? (
                        <img src={image} className="w-full h-full object-cover" alt="Product preview" />
                    ) : (
                        <>
                            <Camera size={24} className="text-slate-400 mb-1" />
                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Subir foto local</span>
                        </>
                    )}
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                    {image && (
                        <button 
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setImage(''); }} 
                            className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black text-white rounded-full transition-colors"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Nombre del Producto */}
            <div>
                <label className="text-xs font-bold text-slate-400 ml-1 mb-1.5 block uppercase">Nombre del Artículo</label>
                <input 
                    type="text" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    placeholder="Ej: Ron Santa Teresa Gran Reserva 750ml"
                    className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm" 
                />
            </div>

            {/* Categoría */}
            <div>
                <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Categoría</label>
                <CustomSelect
                    value={category}
                    onChange={setCategory}
                    options={categories.filter(c => c.id !== 'todos').map(c => ({ value: c.id, label: c.label }))}
                />
            </div>

            {/* FORMATOS DE VENTA */}
            <div className="space-y-4">
                <label className="text-xs font-black text-slate-400 ml-1 mb-0.5 block uppercase tracking-wider">Formatos de Venta</label>
                
                {/* Formato 1: Unidad (Fijo) */}
                <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-wider flex items-center gap-1.5">
                            <Tag size={14} className="text-emerald-500" /> Venta por Unidad (Fijo)
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="relative">
                            <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">CÓD. BARRAS</label>
                            <input 
                                type="text" 
                                value={barcode} 
                                onChange={e => setBarcode(e.target.value)} 
                                placeholder="Escanear o ingresar..."
                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                            />
                            <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">PRECIO USD ($)</label>
                            <input 
                                type="number" 
                                inputMode="decimal" 
                                value={priceUsd} 
                                onChange={e => handlePriceUsdChange(e.target.value)} 
                                placeholder="1.50"
                                className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block flex justify-between">
                                <span>PRECIO BS (MANUAL)</span>
                                {parsedPrice > 0 && effectiveRate > 0 && (
                                    <span className="text-[8px] text-slate-400 font-medium">Ref: {(parsedPrice * effectiveRate).toFixed(2)} Bs</span>
                                )}
                            </label>
                            <input 
                                type="number" 
                                inputMode="decimal" 
                                value={priceBsManual} 
                                onChange={e => setPriceBsManual(e.target.value)} 
                                placeholder="0.00"
                                className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                            />
                        </div>
                    </div>
                </div>

                {/* Formato 2: Caja (Toggle) */}
                <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div 
                            className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                            onClick={() => setSellByBox(!sellByBox)}
                        >
                            <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                        </div>
                        <div onClick={() => setSellByBox(!sellByBox)} className="flex-1">
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                <Package size={14} className={sellByBox ? 'text-emerald-500' : 'text-slate-400'} /> ¿Vender por Caja?
                            </span>
                            <p className="text-[9px] text-slate-400 mt-0.5">Permite vender la caja cerrada (huacal o bulto) con precio especial</p>
                        </div>
                    </label>

                    {sellByBox && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">UDS POR CAJA</label>
                                <input 
                                    type="number" 
                                    inputMode="numeric" 
                                    value={boxUnits} 
                                    onChange={e => setBoxUnits(e.target.value)} 
                                    placeholder="Ej: 36"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div className="relative">
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">CÓD. BARRAS CAJA</label>
                                <input 
                                    type="text" 
                                    value={boxBarcode} 
                                    onChange={e => setBoxBarcode(e.target.value)} 
                                    placeholder="Código caja..."
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                                <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">PRECIO CAJA ($)</label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={boxPriceUsd} 
                                    onChange={e => setBoxPriceUsd(e.target.value)} 
                                    placeholder="45.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block flex justify-between">
                                    <span>PRECIO CAJA BS</span>
                                    {Number(boxPriceUsd) > 0 && effectiveRate > 0 && (
                                        <span className="text-[8px] text-slate-400 font-medium">Ref: {(Number(boxPriceUsd) * effectiveRate).toFixed(2)} Bs</span>
                                    )}
                                </label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={boxPriceBs} 
                                    onChange={e => setBoxPriceBs(e.target.value)} 
                                    placeholder="1700.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Formato 3: ½ Caja (Toggle) */}
                <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                        <div 
                            className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByHalfBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                            onClick={() => setSellByHalfBox(!sellByHalfBox)}
                        >
                            <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByHalfBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                        </div>
                        <div onClick={() => setSellByHalfBox(!sellByHalfBox)} className="flex-1">
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                <Package size={14} className={sellByHalfBox ? 'text-emerald-500' : 'text-slate-400'} /> ¿Vender por ½ Caja?
                            </span>
                            <p className="text-[9px] text-slate-400 mt-0.5">Permite vender la mitad de la caja con su propio precio</p>
                        </div>
                    </label>

                    {sellByHalfBox && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">UDS POR ½ CAJA</label>
                                <input 
                                    type="number" 
                                    inputMode="numeric" 
                                    value={halfBoxUnits} 
                                    onChange={e => setHalfBoxUnits(e.target.value)} 
                                    placeholder={boxUnits ? Math.floor(parseInt(boxUnits, 10) / 2).toString() : "18"}
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div className="relative">
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">CÓD. BARRAS ½ CAJA</label>
                                <input 
                                    type="text" 
                                    value={halfBoxBarcode} 
                                    onChange={e => setHalfBoxBarcode(e.target.value)} 
                                    placeholder="Código media..."
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-750 dark:text-white outline-none border border-slate-200 dark:border-slate-850" 
                                />
                                <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block">PRECIO ½ CAJA ($)</label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={halfBoxPriceUsd} 
                                    onChange={e => setHalfBoxPriceUsd(e.target.value)} 
                                    placeholder="24.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-400 ml-1 mb-1 block flex justify-between">
                                    <span>PRECIO ½ CAJA BS</span>
                                    {Number(halfBoxPriceUsd) > 0 && effectiveRate > 0 && (
                                        <span className="text-[8px] text-slate-400 font-medium">Ref: {(Number(halfBoxPriceUsd) * effectiveRate).toFixed(2)} Bs</span>
                                    )}
                                </label>
                                <input 
                                    type="number" 
                                    inputMode="decimal" 
                                    value={halfBoxPriceBs} 
                                    onChange={e => setHalfBoxPriceBs(e.target.value)} 
                                    placeholder="900.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-black text-xs text-[#193275] dark:text-brand outline-none border border-slate-200 dark:border-slate-850" 
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* SECCIÓN COSTO (SÓLO DE LA UNIDAD) */}
            <div className="bg-slate-50 dark:bg-slate-800/20 p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800/40">
                <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-2 ml-1">
                    Costo de Adquisición (Unidad)
                </span>
                <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">$</span>
                        <input 
                            type="number" 
                            inputMode="decimal" 
                            value={costUsd} 
                            onChange={e => handleCostUsdChange(e.target.value)} 
                            placeholder="1.00"
                            className="w-full bg-white dark:bg-slate-900 p-2.5 pl-7 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200/60 dark:border-slate-800/40 focus:ring-2 focus:ring-slate-500/40 transition-all text-xs" 
                        />
                    </div>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">Bs</span>
                        <input 
                            type="number" 
                            inputMode="decimal" 
                            value={costBs} 
                            onChange={e => handleCostBsChange(e.target.value)} 
                            placeholder="0.00"
                            className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200/60 dark:border-slate-800/40 focus:ring-2 focus:ring-slate-500/40 transition-all text-xs" 
                        />
                    </div>
                </div>
            </div>

            {/* MARGEN DE GANANCIA (SÓLO DE LA UNIDAD) */}
            <div className={`p-3.5 rounded-xl border space-y-1.5 min-h-[60px] ${mainMarginPct !== null && mainMarginPct < 0
                ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30'
                : mainMarginPct !== null && mainMarginPct === 0
                    ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800'
                }`}>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Margen de Ganancia de Unidad</p>
                {parsedPrice > 0 && parsedCost > 0 ? (
                    <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Margen / Unidad:</span>
                            <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {mainMarginPct.toFixed(1)}%
                                <span className="text-xs ml-1.5 opacity-80 font-bold">(${mainMarginUsd.toFixed(2)})</span>
                            </span>
                        </div>
                        {mainMarginPct < 0 && (
                            <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 mt-1">
                                <AlertTriangle size={11} /> Estás vendiendo a pérdida
                            </p>
                        )}
                        {mainMarginPct === 0 && (
                            <p className="text-[10px] font-bold text-amber-500 flex items-center gap-1 mt-1">
                                <AlertTriangle size={11} /> Punto de equilibrio (sin ganancia)
                            </p>
                        )}
                    </div>
                ) : (
                    <div className="text-xs text-slate-400 italic">
                        Ingresa precio y costo para ver la ganancia de la unidad.
                    </div>
                )}
            </div>

            {/* SECCIÓN STOCK Y ALERTA MÍNIMA */}
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock (Unidades)</label>
                    <input 
                        type="number" 
                        inputMode="numeric" 
                        value={stock} 
                        onChange={e => setStock(e.target.value)} 
                        placeholder="0"
                        className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm" 
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1">
                        <AlertTriangle size={10} /> Alerta mín. (Uds)
                    </label>
                    <input 
                        type="number" 
                        inputMode="numeric" 
                        value={lowStockAlert} 
                        onChange={e => setLowStockAlert(e.target.value)} 
                        placeholder="5"
                        className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3.5 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" 
                    />
                </div>
            </div>

            {/* RESUMEN ANTES DE GUARDAR */}
            {name && parsedPrice > 0 && (
                <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    <button 
                        onClick={() => setShowSummary(!showSummary)}
                        type="button"
                        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                        <span>📋 Resumen de Formatos</span>
                        {showSummary ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {showSummary && (
                        <div className="px-3 py-2.5 space-y-1.5 text-xs bg-white dark:bg-slate-900 animate-in fade-in slide-in-from-top-1 duration-150 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex justify-between"><span className="text-slate-400">Nombre:</span><span className="font-bold text-slate-700 dark:text-white">{name}</span></div>
                            
                            {/* Unidad */}
                            <div className="border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1 text-[11px] font-bold text-[#193275] dark:text-brand">Unidad:</div>
                            <div className="flex justify-between pl-2"><span className="text-slate-400">Precio USD:</span><span className="font-bold text-emerald-600">${parsedPrice.toFixed(2)}</span></div>
                            {priceBsManual && <div className="flex justify-between pl-2"><span className="text-slate-400">Precio Bs (Manual):</span><span className="font-bold text-emerald-600">{Number(priceBsManual).toFixed(2)} Bs</span></div>}
                            
                            {/* Caja */}
                            {sellByBox && (
                                <>
                                    <div className="border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1 text-[11px] font-bold text-[#193275] dark:text-brand">Caja ({boxUnits} uds):</div>
                                    <div className="flex justify-between pl-2"><span className="text-slate-400">Precio USD:</span><span className="font-bold text-emerald-600">${(Number(boxPriceUsd) || 0).toFixed(2)}</span></div>
                                    {boxPriceBs && <div className="flex justify-between pl-2"><span className="text-slate-400">Precio Bs (Manual):</span><span className="font-bold text-emerald-600">{Number(boxPriceBs).toFixed(2)} Bs</span></div>}
                                </>
                            )}
                            
                            {/* Media Caja */}
                            {sellByHalfBox && (
                                <>
                                    <div className="border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1 text-[11px] font-bold text-[#193275] dark:text-brand">Media Caja ({halfBoxUnits} uds):</div>
                                    <div className="flex justify-between pl-2"><span className="text-slate-400">Precio USD:</span><span className="font-bold text-emerald-600">${(Number(halfBoxPriceUsd) || 0).toFixed(2)}</span></div>
                                    {halfBoxPriceBs && <div className="flex justify-between pl-2"><span className="text-slate-400">Precio Bs (Manual):</span><span className="font-bold text-emerald-600">{Number(halfBoxPriceBs).toFixed(2)} Bs</span></div>}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
