import React, { useRef, useState, useEffect } from 'react';
import { Camera, X, AlertTriangle, Package, Tag, Barcode, Eye, ShoppingBag } from 'lucide-react';
import CustomSelect from '../CustomSelect';

export default function ProductFormWizard({
    wizardStep,
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

    // Auto-calcular sugerencia de unidades para 1/2 caja cuando cambian las de la caja
    useEffect(() => {
        if (sellByHalfBox && !halfBoxUnits && boxUnits) {
            const calculated = Math.floor(parseInt(boxUnits, 10) / 2);
            if (calculated > 0) {
                setHalfBoxUnits(calculated.toString());
            }
        }
    }, [boxUnits, sellByHalfBox]);

    const parsedPrice = parseFloat(priceUsd) || 0;
    const parsedCost = parseFloat(costUsd) || 0;

    // Margin calculations
    const mainMarginPct = parsedCost > 0 ? ((parsedPrice - parsedCost) / parsedCost * 100) : null;
    const mainMarginUsd = parsedPrice - parsedCost;

    return (
        <div className="space-y-4">
            {/* ─── STEP 1: IDENTIDAD DEL PRODUCTO ─── */}
            {wizardStep === 1 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 1 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Identidad del Producto</h4>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Sube una foto y define el nombre y la categoría.</p>
                    </div>

                    {/* Foto */}
                    <div onClick={() => fileInputRef.current?.click()} className="w-full h-32 bg-slate-50 dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-emerald-500 transition-colors relative overflow-hidden">
                        {image ? <img src={image} className="w-full h-full object-cover" alt="Product preview" /> : (
                            <>
                                <Camera size={24} className="text-slate-400 mb-1" />
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Subir foto local</span>
                            </>
                        )}
                        <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                        {image && <button onClick={(e) => { e.stopPropagation(); setImage(''); }} className="absolute top-2 right-2 p-1 bg-black/50 text-white rounded-full"><X size={12} /></button>}
                    </div>

                    {/* Nombre */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Nombre del Artículo</label>
                        <input 
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            placeholder="Ej: Ron Santa Teresa Gran Reserva 750ml"
                            className="w-full bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-[#193275]/40 text-sm" 
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
                </div>
            )}

            {/* ─── STEP 2: FORMATOS DE VENTA Y CONTROL ─── */}
            {wizardStep === 2 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 2 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Formatos de Venta</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Define si el artículo se venderá también por Caja y Media Caja con códigos propios.</p>
                    </div>

                    {/* Formato 1: Unidad */}
                    <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                        <div className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-wider flex items-center gap-1">
                            <Tag size={12} className="text-emerald-500" /> Unidad (Fijo)
                        </div>
                        <div className="relative">
                            <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">CÓDIGO DE BARRAS DE UNIDAD</label>
                            <input 
                                value={barcode} 
                                onChange={e => setBarcode(e.target.value)} 
                                placeholder="Escanear código..."
                                className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                            />
                            <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                        </div>
                    </div>

                    {/* Formato 2: Caja */}
                    <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <div className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                                onClick={() => setSellByBox(!sellByBox)}>
                                <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                            </div>
                            <div onClick={() => setSellByBox(!sellByBox)}>
                                <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1">
                                    <Package size={12} /> Habilitar venta por Caja
                                </span>
                            </div>
                        </label>
                        {sellByBox && (
                            <div className="grid grid-cols-2 gap-3 pt-1 animate-in fade-in slide-in-from-top-1">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">UNIDADES POR CAJA</label>
                                    <input 
                                        type="number" 
                                        value={boxUnits} 
                                        onChange={e => setBoxUnits(e.target.value)} 
                                        placeholder="Ej: 36"
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                </div>
                                <div className="relative">
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">CÓD. BARRAS CAJA</label>
                                    <input 
                                        type="text" 
                                        value={boxBarcode} 
                                        onChange={e => setBoxBarcode(e.target.value)} 
                                        placeholder="Código caja..."
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                    <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Formato 3: ½ Caja */}
                    <div className="bg-slate-50/50 dark:bg-slate-850/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer select-none">
                            <div className={`w-10 h-5.5 rounded-full relative transition-colors duration-200 shrink-0 ${sellByHalfBox ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-650'}`}
                                onClick={() => setSellByHalfBox(!sellByHalfBox)}>
                                <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform duration-200 ${sellByHalfBox ? 'translate-x-[20px]' : 'translate-x-0.5'}`} />
                            </div>
                            <div onClick={() => setSellByHalfBox(!sellByHalfBox)}>
                                <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1">
                                    <Package size={12} /> Habilitar venta por ½ Caja
                                </span>
                            </div>
                        </label>
                        {sellByHalfBox && (
                            <div className="grid grid-cols-2 gap-3 pt-1 animate-in fade-in slide-in-from-top-1">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">UNIDADES EN ½ CAJA</label>
                                    <input 
                                        type="number" 
                                        value={halfBoxUnits} 
                                        onChange={e => setHalfBoxUnits(e.target.value)} 
                                        placeholder={boxUnits ? Math.floor(parseInt(boxUnits, 15) / 2).toString() : "18"}
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                </div>
                                <div className="relative">
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block">CÓD. BARRAS ½ CAJA</label>
                                    <input 
                                        type="text" 
                                        value={halfBoxBarcode} 
                                        onChange={e => setHalfBoxBarcode(e.target.value)} 
                                        placeholder="Código media..."
                                        className="w-full bg-white dark:bg-slate-900 p-2.5 pl-8 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800" 
                                    />
                                    <Barcode size={14} className="absolute left-2.5 bottom-3.5 text-slate-400" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ─── STEP 3: COSTOS Y PRECIOS DUALES ─── */}
            {wizardStep === 3 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 3 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Costos y Ganancias</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Asigna precios en USD y en Bs independientes para cada formato.</p>
                    </div>

                    {/* Costos (Unidad) */}
                    <div className="bg-slate-50 dark:bg-slate-800/20 p-3 rounded-xl border border-slate-200/60 dark:border-slate-800/40">
                        <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-1.5 ml-1">
                            Costo de Adquisición (Unidad)
                        </span>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">$</span>
                                <input type="number" inputMode="decimal" value={costUsd} onChange={e => handleCostUsdChange(e.target.value)} placeholder="1.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2 pl-7 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800/40" />
                            </div>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">Bs</span>
                                <input type="number" inputMode="decimal" value={costBs} onChange={e => handleCostBsChange(e.target.value)} placeholder="0.00"
                                    className="w-full bg-white dark:bg-slate-900 p-2 pl-8 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-800/40" />
                            </div>
                        </div>
                    </div>

                    {/* Precios Unidad */}
                    <div className="bg-emerald-500/5 dark:bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                        <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest block mb-1.5 ml-1">Precio de Venta Unidad</span>
                        <div className="grid grid-cols-2 gap-3">
                            <input type="number" inputMode="decimal" value={priceUsd} onChange={e => handlePriceUsdChange(e.target.value)} placeholder="Precio USD ($)"
                                className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-emerald-500 outline-none border border-slate-200 dark:border-slate-800" />
                            <input type="number" inputMode="decimal" value={priceBsManual} onChange={e => setPriceBsManual(e.target.value)} placeholder="Precio Bs (Manual)"
                                className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-emerald-500 outline-none border border-slate-200 dark:border-slate-800" />
                        </div>
                    </div>

                    {/* Precios Caja */}
                    {sellByBox && (
                        <div className="bg-blue-500/5 dark:bg-blue-500/10 p-3 rounded-xl border border-blue-500/20 animate-in fade-in slide-in-from-top-1">
                            <span className="text-[9px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest block mb-1.5 ml-1">Precio de Venta Caja ({boxUnits} uds)</span>
                            <div className="grid grid-cols-2 gap-3">
                                <input type="number" inputMode="decimal" value={boxPriceUsd} onChange={e => setBoxPriceUsd(e.target.value)} placeholder="Precio USD ($)"
                                    className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-blue-500 outline-none border border-slate-200 dark:border-slate-800" />
                                <input type="number" inputMode="decimal" value={boxPriceBs} onChange={e => setBoxPriceBs(e.target.value)} placeholder="Precio Bs (Manual)"
                                    className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-blue-500 outline-none border border-slate-200 dark:border-slate-800" />
                            </div>
                        </div>
                    )}

                    {/* Precios ½ Caja */}
                    {sellByHalfBox && (
                        <div className="bg-purple-500/5 dark:bg-purple-500/10 p-3 rounded-xl border border-purple-500/20 animate-in fade-in slide-in-from-top-1">
                            <span className="text-[9px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-widest block mb-1.5 ml-1">Precio de Venta ½ Caja ({halfBoxUnits} uds)</span>
                            <div className="grid grid-cols-2 gap-3">
                                <input type="number" inputMode="decimal" value={halfBoxPriceUsd} onChange={e => setHalfBoxPriceUsd(e.target.value)} placeholder="Precio USD ($)"
                                    className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-purple-500 outline-none border border-slate-200 dark:border-slate-800" />
                                <input type="number" inputMode="decimal" value={halfBoxPriceBs} onChange={e => setHalfBoxPriceBs(e.target.value)} placeholder="Precio Bs (Manual)"
                                    className="w-full bg-white dark:bg-slate-900 p-2 rounded-xl font-black text-xs text-slate-750 dark:text-purple-500 outline-none border border-slate-200 dark:border-slate-800" />
                            </div>
                        </div>
                    )}

                    {/* Margen de Ganancia Unidad */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 p-3.5 rounded-xl text-xs flex justify-between items-center">
                        <span className="text-slate-400 font-bold">Margen / Unidad:</span>
                        {parsedPrice > 0 && parsedCost > 0 ? (
                            <span className={`font-black ${mainMarginPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                {mainMarginPct.toFixed(1)}% (${mainMarginUsd.toFixed(2)})
                            </span>
                        ) : (
                            <span className="text-slate-400 italic">Requiere precio y costo</span>
                        )}
                    </div>
                </div>
            )}

            {/* ─── STEP 4: RESUMEN Y CONFIGURACION STOCK ─── */}
            {wizardStep === 4 && (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
                    <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-xs font-black text-[#193275] dark:text-brand uppercase tracking-widest block mb-1">Paso 4 de 4</span>
                        <h4 className="text-sm font-black text-slate-800 dark:text-white">Inventario y Confirmación</h4>
                        <p className="text-[10px] text-slate-400 mt-0.5">Ingresa el stock físico del producto y confirma la ficha.</p>
                    </div>

                    {/* Stock & Alerta inputs */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold text-slate-400 ml-1 mb-1 block uppercase">Stock Inicial (Uds)</label>
                            <input type="number" inputMode="numeric" value={stock} onChange={e => setStock(e.target.value)} placeholder="0"
                                className="w-full bg-slate-50 dark:bg-slate-800 p-3 rounded-xl font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm" />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-amber-500 ml-1 mb-1 block uppercase flex items-center gap-1">
                                <AlertTriangle size={10} /> Alerta Mínima
                            </label>
                            <input type="number" inputMode="numeric" value={lowStockAlert} onChange={e => setLowStockAlert(e.target.value)} placeholder="5"
                                className="w-full bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-800/30 p-3 rounded-xl font-bold text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/50 text-sm" />
                        </div>
                    </div>

                    {/* Previsualización de Ficha de Producto */}
                    <div className="bg-gradient-to-br from-slate-50 to-white dark:from-slate-850 dark:to-slate-900 p-4 rounded-2xl border border-slate-200/50 dark:border-slate-800 shadow-md relative overflow-hidden flex gap-4 items-center">
                        <div className="w-14 h-14 bg-slate-100 dark:bg-slate-700 rounded-xl flex items-center justify-center shrink-0 border border-slate-200/50 overflow-hidden shadow-inner">
                            {image ? <img src={image} className="w-full h-full object-cover" alt="Preview" /> : <ShoppingBag size={24} className="text-slate-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <span className="bg-[#193275]/10 dark:bg-brand/10 text-[#193275] dark:text-brand text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full inline-block mb-1">
                                {categories.find(c => c.id === category)?.label || category || 'Sin categoría'}
                            </span>
                            <h3 className="font-bold text-slate-850 dark:text-white text-sm truncate capitalize leading-tight">
                                {name || 'Sin nombre'}
                            </h3>
                            <div className="text-xs font-black text-slate-800 dark:text-white mt-1">
                                ${parsedPrice.toFixed(2)} / {priceBsManual ? `${parseFloat(priceBsManual).toFixed(2)} Bs` : `${(parsedPrice * effectiveRate).toFixed(2)} Bs`}
                            </div>
                        </div>
                        <div className="absolute right-3 top-3">
                            <Eye size={14} className="text-slate-350" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
