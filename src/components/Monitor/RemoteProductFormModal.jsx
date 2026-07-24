import React, { useState, useEffect } from 'react';
import { X, Package, Barcode, Tag, AlertTriangle, Send, Loader2 } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';
import { derivePricingMode } from '../../hooks/useProductForm';
import PricingModeSelector from '../Products/PricingModeSelector';
import PricePreviewLine from '../Products/PricePreviewLine';

const MODE_LABELS = {
    tasa_dia: 'Tasa del día',
    bcv: 'Siempre BCV',
    dual_usd: 'Dos precios en $',
    bs_fijo: 'Bs congelado',
};

const EMPTY = {
    name: '', category: '', barcode: '',
    priceUsd: '', priceBsManual: '', priceBsUsdRef: '', costUsd: '', stock: '', lowStockAlert: '5',
    sellByBox: false, boxUnits: '', boxBarcode: '', boxPriceUsd: '', boxPriceBs: '', boxPriceBsUsdRef: '', boxPricingMode: 'inherit',
    sellByHalfBox: false, halfBoxUnits: '', halfBoxBarcode: '', halfBoxPriceUsd: '', halfBoxPriceBs: '', halfBoxPriceBsUsdRef: '', halfBoxPricingMode: 'inherit',
    pricingMode: 'tasa_dia',
};

function productToForm(p) {
    if (!p) return { ...EMPTY };
    const s = (v) => (v == null ? '' : String(v));
    return {
        name: s(p.name), category: s(p.category), barcode: s(p.barcode),
        priceUsd: s(p.priceUsd), priceBsManual: s(p.priceBsManual), priceBsUsdRef: s(p.priceBsUsdRef),
        costUsd: s(p.costUsd), stock: s(p.stock), lowStockAlert: s(p.lowStockAlert ?? 5),
        sellByBox: Boolean(p.sellByBox), boxUnits: s(p.boxUnits), boxBarcode: s(p.boxBarcode),
        boxPriceUsd: s(p.boxPriceUsd), boxPriceBs: s(p.boxPriceBs), boxPriceBsUsdRef: s(p.boxPriceBsUsdRef),
        boxPricingMode: derivePricingMode(p, 'box'),
        sellByHalfBox: Boolean(p.sellByHalfBox), halfBoxUnits: s(p.halfBoxUnits), halfBoxBarcode: s(p.halfBoxBarcode),
        halfBoxPriceUsd: s(p.halfBoxPriceUsd), halfBoxPriceBs: s(p.halfBoxPriceBs), halfBoxPriceBsUsdRef: s(p.halfBoxPriceBsUsdRef),
        halfBoxPricingMode: derivePricingMode(p, 'halfBox'),
        pricingMode: derivePricingMode(p, 'unit'),
    };
}

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl font-bold text-xs text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-brand/40';
const labelCls = 'text-[9px] font-bold text-slate-400 ml-1 mb-0.5 block uppercase';

export default function RemoteProductFormModal({ isOpen, onClose, editingProduct, onSubmit, effectiveRate, bcvRate }) {
    const { categories } = useProductContext();
    const [form, setForm] = useState(EMPTY);
    const [sending, setSending] = useState(false);

    useEffect(() => {
        if (isOpen) setForm(productToForm(editingProduct));
    }, [isOpen, editingProduct]);

    if (!isOpen) return null;

    const set = (field) => (e) => {
        const value = e?.target ? e.target.value : e;
        setForm(prev => ({ ...prev, [field]: value }));
    };
    const toggle = (field) => () => setForm(prev => {
        const next = { ...prev, [field]: !prev[field] };
        if (field === 'sellByBox' && !next.sellByBox) next.sellByHalfBox = false;
        return next;
    });

    const handleModeChange = (mode) => {
        setForm(prev => ({
            ...prev,
            pricingMode: mode,
            priceBsManual: mode !== 'bs_fijo' ? '' : prev.priceBsManual,
            priceBsUsdRef: mode !== 'dual_usd' ? '' : prev.priceBsUsdRef,
        }));
    };

    const handleBsChangeForUsd = (usdField, bsValue, mode) => {
        const rate = mode === 'bcv' ? (bcvRate > 0 ? bcvRate : effectiveRate) : (effectiveRate > 0 ? effectiveRate : bcvRate);
        const bsNum = parseFloat(bsValue);
        if (!isNaN(bsNum) && bsNum > 0 && rate > 0) {
            const usdCalc = (bsNum / rate).toFixed(2);
            setForm(prev => ({ ...prev, [usdField]: usdCalc }));
        } else if (bsValue === '') {
            setForm(prev => ({ ...prev, [usdField]: '' }));
        }
    };

    const priceNum = Number(form.priceUsd) || 0;
    const canSave = form.name.trim().length >= 3 && priceNum > 0
        && (!form.sellByBox || parseInt(form.boxUnits, 10) > 0)
        && (!form.sellByHalfBox || parseInt(form.halfBoxUnits, 10) > 0);

    const handleSubmit = async () => {
        if (!canSave || sending) return;
        setSending(true);
        try {
            const mode = form.pricingMode;
            const boxEffMode = form.boxPricingMode === 'inherit' ? mode : form.boxPricingMode;
            const halfBoxEffMode = form.halfBoxPricingMode === 'inherit' ? mode : form.halfBoxPricingMode;

            const data = {
                ...(editingProduct || {}),
                name: form.name.trim(),
                category: form.category || editingProduct?.category || 'varios',
                barcode: form.barcode.trim() || null,
                priceUsd: Number(form.priceUsd) || 0,
                priceBsManual: mode === 'bs_fijo' && form.priceBsManual !== '' ? Number(form.priceBsManual) : null,
                priceBsUsdRef: mode === 'dual_usd' && form.priceBsUsdRef !== '' ? Number(form.priceBsUsdRef) : null,
                forceBcv: mode === 'bcv',
                pricingMode: mode,
                costUsd: Number(form.costUsd) || 0,
                stock: parseInt(form.stock, 10) || 0,
                lowStockAlert: parseInt(form.lowStockAlert, 10) || 5,

                sellByBox: form.sellByBox,
                boxUnits: form.sellByBox ? parseInt(form.boxUnits, 10) || null : null,
                boxBarcode: form.sellByBox ? form.boxBarcode.trim() || null : null,
                boxPricingMode: form.sellByBox ? form.boxPricingMode : 'inherit',
                boxPriceUsd: form.sellByBox && form.boxPriceUsd !== '' ? Number(form.boxPriceUsd) : null,
                boxPriceBs: form.sellByBox && boxEffMode === 'bs_fijo' && form.boxPriceBs !== '' ? Number(form.boxPriceBs) : null,
                boxPriceBsUsdRef: form.sellByBox && boxEffMode === 'dual_usd' && form.boxPriceBsUsdRef !== '' ? Number(form.boxPriceBsUsdRef) : null,

                sellByHalfBox: form.sellByBox && form.sellByHalfBox,
                halfBoxUnits: form.sellByHalfBox ? parseInt(form.halfBoxUnits, 10) || null : null,
                halfBoxBarcode: form.sellByHalfBox ? form.halfBoxBarcode.trim() || null : null,
                halfBoxPricingMode: form.sellByHalfBox ? form.halfBoxPricingMode : 'inherit',
                halfBoxPriceUsd: form.sellByHalfBox && form.halfBoxPriceUsd !== '' ? Number(form.halfBoxPriceUsd) : null,
                halfBoxPriceBs: form.sellByHalfBox && halfBoxEffMode === 'bs_fijo' && form.halfBoxPriceBs !== '' ? Number(form.halfBoxPriceBs) : null,
                halfBoxPriceBsUsdRef: form.sellByHalfBox && halfBoxEffMode === 'dual_usd' && form.halfBoxPriceBsUsdRef !== '' ? Number(form.halfBoxPriceBsUsdRef) : null,
            };
            delete data.image;
            if (!editingProduct) data.id = crypto.randomUUID();
            await onSubmit(editingProduct ? 'edit' : 'add', data.id, data);
            onClose();
        } finally {
            setSending(false);
        }
    };

    const formatBlock = (title, color, modeField, unitsField, barcodeField, usdField, bsField, bsUsdRefField, unitsPlaceholder) => {
        const effMode = form[modeField] === 'inherit' ? form.pricingMode : form[modeField];
        const activeRate = effMode === 'bcv' ? (bcvRate > 0 ? bcvRate : effectiveRate) : (effectiveRate > 0 ? effectiveRate : bcvRate);

        return (
            <div className={`p-3 rounded-2xl border space-y-2.5 ${color}`}>
                <div className="flex items-center justify-between border-b border-slate-200/40 dark:border-slate-800/40 pb-2">
                    <span className="text-[10px] font-black uppercase tracking-wider">{title}</span>
                    {form[modeField] === 'inherit' ? (
                        <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, [modeField]: form.pricingMode }))}
                            className="text-[9px] font-black text-brand hover:underline uppercase cursor-pointer"
                        >
                            Usar otra regla
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setForm(f => ({ ...f, [modeField]: 'inherit' }))}
                            className="text-[9px] font-black text-slate-400 hover:text-brand uppercase cursor-pointer"
                        >
                            Volver a heredar
                        </button>
                    )}
                </div>

                {form[modeField] === 'inherit' ? (
                    <div className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800/60 text-[9px] font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                        <span>Regla: Sigue la regla de la Unidad ({MODE_LABELS[form.pricingMode] || 'Tasa del día'})</span>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Regla propia para {title}</span>
                        <PricingModeSelector
                            compact
                            value={form[modeField]}
                            onChange={(m) => setForm(f => ({ ...f, [modeField]: m }))}
                            effectiveRate={effectiveRate}
                            bcvRate={bcvRate}
                        />
                    </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className={labelCls}>Unidades</label>
                        <input type="number" inputMode="numeric" value={form[unitsField]} onChange={set(unitsField)} placeholder={unitsPlaceholder} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Cód. barras</label>
                        <input type="text" value={form[barcodeField]} onChange={set(barcodeField)} placeholder="Escanear..." className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>{effMode === 'dual_usd' ? '$ en divisa' : 'Precio USD ($)'}</label>
                        <input type="number" inputMode="decimal" value={form[usdField]} onChange={set(usdField)} placeholder="0.00" className={inputCls} />
                    </div>
                    {(effMode === 'bcv' || effMode === 'tasa_dia') && (
                        <div>
                            <label className={labelCls}>
                                Precio Bs ({effMode === 'bcv' ? 'tasa BCV' : 'tasa Día'}: {activeRate ? activeRate.toFixed(2) : 'N/D'})
                            </label>
                            <input
                                type="number"
                                inputMode="decimal"
                                value={Number(form[usdField]) > 0 && activeRate > 0 ? (Number(form[usdField]) * activeRate).toFixed(2) : ''}
                                onChange={(e) => handleBsChangeForUsd(usdField, e.target.value, effMode)}
                                placeholder="0.00 Bs"
                                className={inputCls}
                            />
                        </div>
                    )}
                    {effMode === 'bs_fijo' && (
                        <div>
                            <label className={labelCls}>Precio Bs (Fijo)</label>
                            <input type="number" inputMode="decimal" value={form[bsField]} onChange={set(bsField)} placeholder="0.00" className={inputCls} />
                        </div>
                    )}
                    {effMode === 'dual_usd' && (
                        <div>
                            <label className={labelCls}>$ si paga en Bs</label>
                            <input type="number" inputMode="decimal" value={form[bsUsdRefField]} onChange={set(bsUsdRefField)} placeholder="0.00" className={inputCls} />
                        </div>
                    )}
                </div>

                <PricePreviewLine
                    mode={effMode}
                    usd={form[usdField]}
                    bsManual={form[bsField]}
                    bsUsdRef={form[bsUsdRefField]}
                    effectiveRate={effectiveRate}
                    bcvRate={bcvRate}
                />
            </div>
        );
    };

    const unitActiveRate = form.pricingMode === 'bcv' ? (bcvRate > 0 ? bcvRate : effectiveRate) : (effectiveRate > 0 ? effectiveRate : bcvRate);

    return (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 bg-brand-light/60 dark:bg-slate-800 rounded-xl flex items-center justify-center">
                            <Package size={18} className="text-brand" />
                        </div>
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-sm">
                                {editingProduct ? 'Editar producto (remoto)' : 'Nuevo producto (remoto)'}
                            </h3>
                            <p className="text-[10px] text-slate-400 font-bold">Se encolará hasta pulsar «Subir al sistema»</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Identidad */}
                <div className="space-y-2">
                    <div>
                        <label className={labelCls}>Nombre</label>
                        <input value={form.name} onChange={set('name')} placeholder="Ej: Ron Santa Teresa 750ml" className={inputCls} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelCls}>Categoría</label>
                            <select value={form.category} onChange={set('category')} className={inputCls}>
                                <option value="">Seleccionar...</option>
                                {(categories || []).filter(c => c.id !== 'todos').map(c => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}><Barcode size={9} className="inline mr-0.5" />Cód. barras unidad</label>
                            <input value={form.barcode} onChange={set('barcode')} placeholder="Escanear..." className={inputCls} />
                        </div>
                    </div>
                </div>

                {/* Modo de precio Unidad */}
                <div className="space-y-1.5">
                    <label className={labelCls}>¿Cómo se cobra la Unidad?</label>
                    <PricingModeSelector
                        value={form.pricingMode}
                        onChange={handleModeChange}
                        effectiveRate={effectiveRate}
                        bcvRate={bcvRate}
                    />
                </div>

                {/* Precio Unidad */}
                <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-2">
                    <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1"><Tag size={10} /> Unidad</span>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelCls}>{form.pricingMode === 'dual_usd' ? '$ en divisa' : 'Precio USD ($)'}</label>
                            <input type="number" inputMode="decimal" value={form.priceUsd} onChange={set('priceUsd')} placeholder="0.00" className={inputCls} />
                        </div>
                        {(form.pricingMode === 'bcv' || form.pricingMode === 'tasa_dia') && (
                            <div>
                                <label className={labelCls}>
                                    Precio Bs ({form.pricingMode === 'bcv' ? 'tasa BCV' : 'tasa Día'}: {unitActiveRate ? unitActiveRate.toFixed(2) : 'N/D'})
                                </label>
                                <input
                                    type="number"
                                    inputMode="decimal"
                                    value={Number(form.priceUsd) > 0 && unitActiveRate > 0 ? (Number(form.priceUsd) * unitActiveRate).toFixed(2) : ''}
                                    onChange={(e) => handleBsChangeForUsd('priceUsd', e.target.value, form.pricingMode)}
                                    placeholder="0.00 Bs"
                                    className={inputCls}
                                />
                            </div>
                        )}
                        {form.pricingMode === 'bs_fijo' && (
                            <div>
                                <label className={labelCls}>Precio Bs (Fijo)</label>
                                <input type="number" inputMode="decimal" value={form.priceBsManual} onChange={set('priceBsManual')} placeholder="0.00" className={inputCls} />
                            </div>
                        )}
                        {form.pricingMode === 'dual_usd' && (
                            <div>
                                <label className={labelCls}>$ si paga en Bs</label>
                                <input type="number" inputMode="decimal" value={form.priceBsUsdRef} onChange={set('priceBsUsdRef')} placeholder="0.00" className={inputCls} />
                            </div>
                        )}
                    </div>
                    <PricePreviewLine
                        mode={form.pricingMode}
                        usd={form.priceUsd}
                        bsManual={form.priceBsManual}
                        bsUsdRef={form.priceBsUsdRef}
                        effectiveRate={effectiveRate}
                        bcvRate={bcvRate}
                    />
                </div>

                {/* Toggle Caja */}
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input type="checkbox" checked={form.sellByBox} onChange={toggle('sellByBox')} className="w-4 h-4 accent-emerald-500" />
                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Vender por Caja</span>
                </label>
                {form.sellByBox && formatBlock('Caja', 'border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400', 'boxPricingMode', 'boxUnits', 'boxBarcode', 'boxPriceUsd', 'boxPriceBs', 'boxPriceBsUsdRef', 'Ej: 36')}

                {/* Toggle ½ Caja */}
                <label className={`flex items-center gap-2.5 select-none ${form.sellByBox ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'}`}>
                    <input type="checkbox" checked={form.sellByHalfBox} disabled={!form.sellByBox} onChange={toggle('sellByHalfBox')} className="w-4 h-4 accent-emerald-500" />
                    <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                        Vender por ½ Caja {!form.sellByBox && <span className="text-rose-500 normal-case">(requiere Caja)</span>}
                    </span>
                </label>
                {form.sellByHalfBox && formatBlock('½ Caja', 'border-purple-500/20 bg-purple-500/5 text-purple-600 dark:text-purple-400', 'halfBoxPricingMode', 'halfBoxUnits', 'halfBoxBarcode', 'halfBoxPriceUsd', 'halfBoxPriceBs', 'halfBoxPriceBsUsdRef', form.boxUnits ? String(Math.floor((parseInt(form.boxUnits, 10) || 0) / 2)) : '18')}

                {/* Costo / Stock / Alerta */}
                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className={labelCls}>Costo USD</label>
                        <input type="number" inputMode="decimal" value={form.costUsd} onChange={set('costUsd')} placeholder="0.00" className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Stock (Uds)</label>
                        <input
                            type="number" inputMode="numeric" value={form.stock} onChange={set('stock')} placeholder="0"
                            disabled={Boolean(editingProduct)}
                            title={editingProduct ? 'Ajusta con +/- en la lista' : undefined}
                            className={`${inputCls} ${editingProduct ? 'opacity-40 cursor-not-allowed' : ''}`}
                        />
                        {editingProduct && <span className="text-[8px] text-slate-400 font-medium block mt-0.5 ml-1">Ajusta con +/-</span>}
                    </div>
                    <div>
                        <label className={`${labelCls} text-amber-500 flex items-center gap-0.5`}><AlertTriangle size={9} /> Alerta mín.</label>
                        <input type="number" inputMode="numeric" value={form.lowStockAlert} onChange={set('lowStockAlert')} placeholder="5" className={inputCls} />
                    </div>
                </div>

                <button
                    onClick={handleSubmit}
                    disabled={!canSave || sending}
                    className="w-full py-3 rounded-2xl font-black text-white uppercase tracking-wider text-xs bg-brand hover:bg-brand-dark shadow-lg shadow-brand/25 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? 'Guardando...' : 'Guardar en cola'}
                </button>
                <p className="text-[9px] text-slate-400 text-center -mt-1">Se enviará a la caja al pulsar «Subir al sistema». La foto se gestiona desde la caja.</p>
            </div>
        </div>
    );
}
