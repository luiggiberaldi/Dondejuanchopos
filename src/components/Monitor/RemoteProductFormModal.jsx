import React, { useState, useEffect } from 'react';
import { 
    X, Package, Barcode, Tag, AlertTriangle, Send, Loader2, 
    TrendingUp, Layers, Sparkles, PlusCircle, Camera, Banknote, 
    Zap, Boxes, Coins, ShieldCheck, Landmark 
} from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import { CurrencyService } from '../../services/CurrencyService';
import { mulR, divR, round2 } from '../../utils/dinero';

const EMPTY = {
    name: '', category: '', barcode: '',
    priceUsd: '', priceBsManual: '', costUsd: '', stock: '', lowStockAlert: '5',
    sellByBox: false, boxUnits: '', boxBarcode: '', boxPriceUsd: '', boxPriceBs: '',
    sellByHalfBox: false, halfBoxUnits: '', halfBoxBarcode: '', halfBoxPriceUsd: '', halfBoxPriceBs: '',
    forceBcv: false,
    // Campos para costo por caja
    calcCostByBox: false, purchaseByBoxCost: '', purchaseBoxUnits: '',
};

function productToForm(p) {
    if (!p) return { ...EMPTY };
    const s = (v) => (v == null ? '' : String(v));
    return {
        name: s(p.name), category: s(p.category), barcode: s(p.barcode),
        priceUsd: s(p.priceUsd), priceBsManual: s(p.priceBsManual),
        costUsd: s(p.costUsd), stock: s(p.stock), lowStockAlert: s(p.lowStockAlert ?? 5),
        sellByBox: Boolean(p.sellByBox), boxUnits: s(p.boxUnits), boxBarcode: s(p.boxBarcode),
        boxPriceUsd: s(p.boxPriceUsd), boxPriceBs: s(p.boxPriceBs),
        sellByHalfBox: Boolean(p.sellByHalfBox), halfBoxUnits: s(p.halfBoxUnits), halfBoxBarcode: s(p.halfBoxBarcode),
        halfBoxPriceUsd: s(p.halfBoxPriceUsd), halfBoxPriceBs: s(p.halfBoxPriceBs),
        forceBcv: Boolean(p.forceBcv),
        calcCostByBox: false, purchaseByBoxCost: '', purchaseBoxUnits: '',
    };
}

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800/80 p-3 rounded-xl font-bold text-xs text-slate-800 dark:text-white outline-none border border-slate-200/80 dark:border-slate-700/80 focus:ring-2 focus:ring-purple-400/50 transition-all placeholder:text-slate-400/60';
const labelCls = 'text-[10px] font-black text-slate-400 ml-1 mb-1 block uppercase tracking-wider flex items-center gap-1';

export default function RemoteProductFormModal({ isOpen, onClose, editingProduct, onSubmit, effectiveRate }) {
    const { categories, rates } = useProductContext();
    const [form, setForm] = useState(EMPTY);
    const [sending, setSending] = useState(false);
    
    // Auto-tasa toggle para sincronizar USD ⇔ Bs en el supervisor
    const [autoCalcUnit, setAutoCalcUnit] = useState(true);
    const [customCatInput, setCustomCatInput] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setForm(productToForm(editingProduct));
            setAutoCalcUnit(true);
            setCustomCatInput(false);
        }
    }, [isOpen, editingProduct]);

    if (!isOpen) return null;

    const handleToggleAutoCalcUnit = () => {
        const nextAuto = !autoCalcUnit;
        setAutoCalcUnit(nextAuto);
        if (nextAuto && effectiveRate > 0) {
            setForm(prev => {
                const usdVal = parseFloat(prev.priceUsd) || 0;
                const bUsd = parseFloat(prev.boxPriceUsd) || 0;
                const hbUsd = parseFloat(prev.halfBoxPriceUsd) || 0;
                return {
                    ...prev,
                    priceBsManual: usdVal > 0 ? (usdVal * effectiveRate).toFixed(2) : prev.priceBsManual,
                    boxPriceBs: bUsd > 0 ? (bUsd * effectiveRate).toFixed(2) : prev.boxPriceBs,
                    halfBoxPriceBs: hbUsd > 0 ? (hbUsd * effectiveRate).toFixed(2) : prev.halfBoxPriceBs,
                };
            });
        }
    };

    const set = (field) => (e) => {
        const value = e?.target ? e.target.value : e;
        setForm(prev => {
            const next = { ...prev, [field]: value };
            
            // Auto-cálculo de precio Bs si Auto-Tasa está activo
            if (autoCalcUnit && effectiveRate > 0) {
                if (field === 'priceUsd') {
                    const usdVal = parseFloat(value) || 0;
                    next.priceBsManual = usdVal > 0 ? (usdVal * effectiveRate).toFixed(2) : '';
                } else if (field === 'boxPriceUsd') {
                    const bUsd = parseFloat(value) || 0;
                    next.boxPriceBs = bUsd > 0 ? (bUsd * effectiveRate).toFixed(2) : '';
                } else if (field === 'halfBoxPriceUsd') {
                    const hbUsd = parseFloat(value) || 0;
                    next.halfBoxPriceBs = hbUsd > 0 ? (hbUsd * effectiveRate).toFixed(2) : '';
                }
            }

            // Recalcular costo unitario si cambia compra por caja
            if ((field === 'purchaseByBoxCost' || field === 'purchaseBoxUnits') && next.calcCostByBox) {
                const bCost = parseFloat(next.purchaseByBoxCost) || 0;
                const bUnits = parseInt(next.purchaseBoxUnits, 10) || 0;
                if (bCost > 0 && bUnits > 0) {
                    next.costUsd = (bCost / bUnits).toFixed(2);
                }
            }

            return next;
        });
    };

    const toggle = (field) => () => setForm(prev => {
        const next = { ...prev, [field]: !prev[field] };
        if (field === 'sellByBox' && !next.sellByBox) next.sellByHalfBox = false;
        return next;
    });

    const priceNum = parseFloat(form.priceUsd) || 0;
    const costNum = parseFloat(form.costUsd) || 0;
    const profitUsd = Math.max(0, priceNum - costNum);
    const profitPct = priceNum > 0 && costNum > 0 ? Math.round((profitUsd / priceNum) * 100) : 0;

    const nameOk = form.name.trim().length >= 3;
    const priceOk = priceNum > 0;
    const boxOk = !form.sellByBox || parseInt(form.boxUnits, 10) > 0;
    const halfBoxOk = !form.sellByHalfBox || parseInt(form.halfBoxUnits, 10) > 0;

    const canSave = nameOk && priceOk && boxOk && halfBoxOk;

    const handleSubmit = async () => {
        if (!canSave || sending) return;
        setSending(true);
        try {
            const data = {
                ...(editingProduct || {}),
                name: form.name.trim(),
                category: form.category || editingProduct?.category || 'varios',
                barcode: form.barcode.trim() || null,
                priceUsd: parseFloat(form.priceUsd) || 0,
                priceBsManual: form.priceBsManual !== '' ? parseFloat(form.priceBsManual) : null,
                costUsd: parseFloat(form.costUsd) || 0,
                stock: parseInt(form.stock, 10) || 0,
                lowStockAlert: parseInt(form.lowStockAlert, 10) || 5,
                sellByBox: form.sellByBox,
                boxUnits: form.sellByBox ? parseInt(form.boxUnits, 10) || null : null,
                boxBarcode: form.sellByBox ? form.boxBarcode.trim() || null : null,
                boxPriceUsd: form.sellByBox && form.boxPriceUsd !== '' ? parseFloat(form.boxPriceUsd) : null,
                boxPriceBs: form.sellByBox && form.boxPriceBs !== '' ? parseFloat(form.boxPriceBs) : null,
                sellByHalfBox: form.sellByBox && form.sellByHalfBox,
                halfBoxUnits: form.sellByHalfBox ? parseInt(form.halfBoxUnits, 10) || null : null,
                halfBoxBarcode: form.sellByHalfBox ? form.halfBoxBarcode.trim() || null : null,
                halfBoxPriceUsd: form.sellByHalfBox && form.halfBoxPriceUsd !== '' ? parseFloat(form.halfBoxPriceUsd) : null,
                halfBoxPriceBs: form.sellByHalfBox && form.halfBoxPriceBs !== '' ? parseFloat(form.halfBoxPriceBs) : null,
                forceBcv: Boolean(form.forceBcv),
            };

            delete data.image;
            if (!editingProduct) data.id = crypto.randomUUID();

            await onSubmit(editingProduct ? 'edit' : 'add', data.id, data);
            onClose();
        } finally {
            setSending(false);
        }
    };

    const refBs = (usd) => {
        const v = parseFloat(usd) || 0;
        return (effectiveRate > 0 && v > 0)
            ? <span className="text-[9px] text-slate-400 font-bold block mt-1 ml-1">Ref: {(v * effectiveRate).toFixed(2)} Bs (Tasa BCV)</span>
            : null;
    };

    const formatBlock = (title, colorClass, unitsField, barcodeField, usdField, bsField, unitsPlaceholder) => (
        <div className={`p-4 rounded-2xl border space-y-3 shadow-sm transition-all ${colorClass}`}>
            <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">{title}</span>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={labelCls}>Unidades por Empaque</label>
                    <input type="number" inputMode="numeric" value={form[unitsField]} onChange={set(unitsField)} placeholder={unitsPlaceholder} className={inputCls} />
                </div>
                <div>
                    <label className={labelCls}><Barcode size={10} /> Código de Barras</label>
                    <input type="text" value={form[barcodeField]} onChange={set(barcodeField)} placeholder="Escanear o escribir..." className={inputCls} />
                </div>
                <div>
                    <label className={labelCls}>Precio USD ($)</label>
                    <input type="number" inputMode="decimal" value={form[usdField]} onChange={set(usdField)} placeholder="0.00" className={inputCls} />
                </div>
                <div>
                    <label className={labelCls}>Precio Bs (Manual)</label>
                    <input type="number" inputMode="decimal" value={form[bsField]} onChange={set(bsField)} placeholder="0.00" className={inputCls} />
                    {refBs(form[usdField])}
                </div>
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[300] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-3 sm:p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-5 max-w-xl w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[94vh] overflow-y-auto space-y-5 custom-scrollbar">
                
                {/* Cabecera idéntica a la vista real */}
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-2xl flex items-center justify-center shrink-0">
                            {editingProduct ? <Package size={22} /> : <PlusCircle size={22} />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-black text-slate-800 dark:text-white text-base">
                                    {editingProduct ? 'Editar Producto' : 'Crear Nuevo Artículo'}
                                </h3>
                                <span className="text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300">
                                    Modo Supervisor
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                                {editingProduct ? 'Modificando datos remotos del inventario.' : 'Registra un nuevo producto de forma remota para el punto de venta.'}
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* 1. Datos del Artículo (Nombre y Categoría) */}
                <div className="space-y-3.5">
                    <div>
                        <label className={labelCls}>Nombre del Artículo *</label>
                        <input 
                            value={form.name} 
                            onChange={set('name')} 
                            placeholder="Ej: Ron Santa Teresa 750ml / Harina Pan 1kg" 
                            className={`${inputCls} p-3.5 text-sm ${!nameOk && form.name ? 'border-amber-400 focus:ring-amber-400/40' : ''}`}
                        />
                        {!nameOk && form.name && (
                            <span className="text-[9px] text-amber-500 font-bold mt-1 block ml-1">Mínimo 3 caracteres</span>
                        )}
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className={labelCls}>Categoría</label>
                            <button
                                type="button"
                                onClick={() => setCustomCatInput(!customCatInput)}
                                className="text-[9px] font-black text-purple-600 dark:text-purple-400 hover:underline"
                            >
                                {customCatInput ? 'Elegir de lista' : '+ Nueva categoría'}
                            </button>
                        </div>
                        {customCatInput ? (
                            <input
                                type="text"
                                value={form.category}
                                onChange={set('category')}
                                placeholder="Escribe el nombre de la categoría..."
                                className={inputCls}
                            />
                        ) : (
                            <select value={form.category} onChange={set('category')} className={inputCls}>
                                <option value="">Seleccionar categoría...</option>
                                {(categories || []).filter(c => c.id !== 'todos').map(c => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {/* Código de barras */}
                <div>
                    <label className={labelCls}><Barcode size={11} /> Código de Barras Unidad</label>
                    <input 
                        value={form.barcode} 
                        onChange={set('barcode')} 
                        placeholder="Escanear con lector o escribir código..." 
                        className={inputCls} 
                    />
                </div>

                {/* 2. Sección Costo de Adquisición (con selector Por Unidad / Por Caja) */}
                <div className="bg-blue-500/5 dark:bg-blue-500/10 p-4 rounded-2xl border border-blue-500/20 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Banknote size={14} className="text-blue-500" /> Costo de Adquisición
                        </span>
                        
                        {/* Selector Por Unidad / Por Caja */}
                        <div className="flex bg-slate-200/60 dark:bg-slate-800 p-0.5 rounded-xl text-[9px] font-black gap-1">
                            <button
                                type="button"
                                onClick={() => setForm(prev => ({ ...prev, calcCostByBox: false }))}
                                className={`px-2.5 py-1 rounded-lg transition-all ${
                                    !form.calcCostByBox
                                        ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                                        : 'text-slate-400'
                                }`}
                            >
                                Por Unidad
                            </button>
                            <button
                                type="button"
                                onClick={() => setForm(prev => ({ ...prev, calcCostByBox: true }))}
                                className={`px-2.5 py-1 rounded-lg transition-all ${
                                    form.calcCostByBox
                                        ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-white shadow-sm'
                                        : 'text-slate-400'
                                }`}
                            >
                                Por Caja
                            </button>
                        </div>
                    </div>

                    {!form.calcCostByBox ? (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className={labelCls}>Costo USD ($)</label>
                                <input type="number" inputMode="decimal" value={form.costUsd} onChange={set('costUsd')} placeholder="0.00" className={inputCls} />
                            </div>
                            <div>
                                <label className={labelCls}>Costo en Bs (Equivalente)</label>
                                <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-black text-slate-600 dark:text-slate-300">
                                    {costNum > 0 && effectiveRate > 0 ? `${(costNum * effectiveRate).toFixed(2)} Bs` : '0.00 Bs'}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className={labelCls}>Costo Total Caja ($)</label>
                                    <input type="number" inputMode="decimal" value={form.purchaseByBoxCost} onChange={set('purchaseByBoxCost')} placeholder="0.00" className={inputCls} />
                                </div>
                                <div>
                                    <label className={labelCls}>Unidades por Caja</label>
                                    <input type="number" inputMode="numeric" value={form.purchaseBoxUnits} onChange={set('purchaseBoxUnits')} placeholder="Ej: 24" className={inputCls} />
                                </div>
                            </div>
                            {costNum > 0 && (
                                <div className="bg-emerald-500/10 p-2.5 rounded-xl border border-emerald-500/20 text-center">
                                    <span className="text-[10px] text-emerald-600 font-black">✓ Costo Unitario Calculado: ${costNum.toFixed(2)} USD</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 3. Sección Precio de Venta (Unidad) + Margen de Ganancia */}
                <div className="p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Tag size={13} /> Precio de Venta (Unidad)
                        </span>
                        
                        <button
                            type="button"
                            onClick={handleToggleAutoCalcUnit}
                            className={`flex items-center gap-1 text-[9px] font-black px-2.5 py-1 rounded-lg transition-all ${
                                autoCalcUnit ? 'bg-emerald-500 text-white shadow-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                            }`}
                            title="Auto-Tasa: recalcula el precio en Bs según la tasa activa"
                        >
                            <Zap size={10} className={autoCalcUnit ? 'fill-white' : ''} /> Auto-Tasa
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className={labelCls}>Precio USD ($) *</label>
                            <input 
                                type="number" 
                                inputMode="decimal" 
                                value={form.priceUsd} 
                                onChange={set('priceUsd')} 
                                placeholder="0.00" 
                                className={`${inputCls} ${!priceOk && form.priceUsd ? 'border-amber-400 focus:ring-amber-400/40' : ''}`}
                            />
                        </div>
                        <div>
                            <label className={labelCls}>Precio Bs {autoCalcUnit ? '(Auto)' : '(Manual)'}</label>
                            <input 
                                type="number" 
                                inputMode="decimal" 
                                value={form.priceBsManual} 
                                onChange={set('priceBsManual')} 
                                placeholder="0.00" 
                                disabled={autoCalcUnit}
                                className={`${inputCls} ${autoCalcUnit ? 'bg-slate-100 dark:bg-slate-800/50 text-slate-400 cursor-not-allowed' : ''}`} 
                            />
                        </div>
                    </div>

                    {/* Badge de Ganancia Estimada */}
                    {priceNum > 0 && (
                        <div className="flex items-center justify-between p-2.5 bg-emerald-100/60 dark:bg-emerald-900/30 rounded-xl border border-emerald-200 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-300">
                            <span className="text-[10px] font-black uppercase flex items-center gap-1">
                                <TrendingUp size={12} /> Ganancia estimada
                            </span>
                            <span className="text-xs font-black">
                                ${profitUsd.toFixed(2)} USD {costNum > 0 ? `(${profitPct}%)` : ''}
                            </span>
                        </div>
                    )}

                    {/* Toggle Tasa BCV (Forzar siempre a Tasa Oficial BCV) */}
                    <div className="flex items-center justify-between pt-2.5 border-t border-emerald-500/20">
                        <div className="flex items-center gap-2">
                            <Landmark size={15} className="text-blue-500" />
                            <div>
                                <span className="text-xs font-black text-slate-700 dark:text-slate-200 block">Tasa BCV</span>
                                <span className="text-[9px] font-bold text-slate-400 block">Forzar siempre a Tasa Oficial BCV</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                const nextBcv = !form.forceBcv;
                                setForm(prev => {
                                    const next = { ...prev, forceBcv: nextBcv };
                                    if (nextBcv && effectiveRate > 0) {
                                        setAutoCalcUnit(true);
                                        const usdVal = parseFloat(prev.priceUsd) || 0;
                                        next.priceBsManual = usdVal > 0 ? (usdVal * effectiveRate).toFixed(2) : prev.priceBsManual;
                                    }
                                    return next;
                                });
                            }}
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                form.forceBcv ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'
                            }`}
                        >
                            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                                form.forceBcv ? 'translate-x-5' : 'translate-x-0'
                            }`} />
                        </button>
                    </div>
                </div>

                {/* 4. Formatos por Caja / ½ Caja (Switches Táctiles) */}
                <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                            <Layers size={15} className="text-blue-500" />
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Vender por Caja</span>
                        </div>
                        <button
                            type="button"
                            onClick={toggle('sellByBox')}
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                form.sellByBox ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-700'
                            }`}
                        >
                            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                                form.sellByBox ? 'translate-x-5' : 'translate-x-0'
                            }`} />
                        </button>
                    </div>
                    {form.sellByBox && formatBlock('Configuración de Caja', 'border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400', 'boxUnits', 'boxBarcode', 'boxPriceUsd', 'boxPriceBs', 'Ej: 36')}

                    <div className={`flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 transition-opacity ${
                        form.sellByBox ? 'opacity-100' : 'opacity-40 cursor-not-allowed'
                    }`}>
                        <div className="flex items-center gap-2">
                            <Layers size={15} className="text-purple-500" />
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                                Vender por ½ Caja {!form.sellByBox && <span className="text-rose-500 text-[10px] normal-case font-bold">(requiere Caja)</span>}
                            </span>
                        </div>
                        <button
                            type="button"
                            disabled={!form.sellByBox}
                            onClick={toggle('sellByHalfBox')}
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                form.sellByHalfBox ? 'bg-purple-500' : 'bg-slate-300 dark:bg-slate-700'
                            }`}
                        >
                            <div className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ease-in-out ${
                                form.sellByHalfBox ? 'translate-x-5' : 'translate-x-0'
                            }`} />
                        </button>
                    </div>
                    {form.sellByHalfBox && formatBlock('Configuración de ½ Caja', 'border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400', 'halfBoxUnits', 'halfBoxBarcode', 'halfBoxPriceUsd', 'halfBoxPriceBs', form.boxUnits ? String(Math.floor((parseInt(form.boxUnits, 10) || 0) / 2)) : '18')}
                </div>

                {/* 5. Stock e Inventario Mínimo */}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelCls}>Stock Inicial (Unidades)</label>
                        <input
                            type="number" 
                            inputMode="numeric" 
                            value={form.stock} 
                            onChange={set('stock')} 
                            placeholder="0"
                            disabled={Boolean(editingProduct)}
                            title={editingProduct ? 'En producto existente el stock se ajusta con los botones + / -' : undefined}
                            className={`${inputCls} ${editingProduct ? 'opacity-40 cursor-not-allowed' : ''}`}
                        />
                        {editingProduct && <span className="text-[8px] text-slate-400 font-bold block mt-1 ml-1">Usa los botones +/- en la lista</span>}
                    </div>
                    <div>
                        <label className={`${labelCls} text-amber-500`}><AlertTriangle size={10} /> Alerta Stock Mínimo</label>
                        <input type="number" inputMode="numeric" value={form.lowStockAlert} onChange={set('lowStockAlert')} placeholder="5" className={inputCls} />
                    </div>
                </div>

                {/* 6. Botón de Encolado Final */}
                <div className="pt-2">
                    <button
                        onClick={handleSubmit}
                        disabled={!canSave || sending}
                        className="w-full py-4 rounded-2xl font-black text-white uppercase tracking-wider text-xs bg-purple-600 hover:bg-purple-700 shadow-xl shadow-purple-500/25 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                        {sending ? 'Guardando en cola...' : 'Guardar en Cola de Cambios'}
                    </button>
                    <p className="text-[9px] font-bold text-slate-400 text-center mt-2">
                        Se enviará a la caja al pulsar «Subir al sistema» en el panel del supervisor.
                    </p>
                </div>
            </div>
        </div>
    );
}
