import React, { useState, useEffect } from 'react';
import { X, Package, Barcode, Tag, AlertTriangle, Send, Loader2, TrendingUp, Layers, Sparkles, PlusCircle } from 'lucide-react';
import { useProductContext } from '../../context/ProductContext';

// Formulario COMPACTO de producto para el Modo Supervisor (D7 del plan).
// No maneja foto (los comandos no llevan base64; la caja asigna la foto).
// Al guardar no modifica nada local: emite un comando 'inventory_update' hacia la caja vía onSubmit.

const EMPTY = {
    name: '', category: '', barcode: '',
    priceUsd: '', priceBsManual: '', costUsd: '', stock: '', lowStockAlert: '5',
    sellByBox: false, boxUnits: '', boxBarcode: '', boxPriceUsd: '', boxPriceBs: '',
    sellByHalfBox: false, halfBoxUnits: '', halfBoxBarcode: '', halfBoxPriceUsd: '', halfBoxPriceBs: '',
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
    };
}

const inputCls = 'w-full bg-slate-50 dark:bg-slate-800/80 p-2.5 rounded-xl font-bold text-xs text-slate-800 dark:text-white outline-none border border-slate-200/80 dark:border-slate-700/80 focus:ring-2 focus:ring-purple-400/50 transition-all placeholder:text-slate-400/60';
const labelCls = 'text-[9px] font-black text-slate-400 ml-1 mb-1 block uppercase tracking-wider flex items-center gap-1';

export default function RemoteProductFormModal({ isOpen, onClose, editingProduct, onSubmit, effectiveRate }) {
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

    const priceNum = parseFloat(form.priceUsd) || 0;
    const costNum = parseFloat(form.costUsd) || 0;
    const profitUsd = Math.max(0, priceNum - costNum);
    const profitPct = priceNum > 0 ? Math.round((profitUsd / priceNum) * 100) : 0;

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
            };
            // Preservar la imagen en la caja si existe; no enviar base64 desde el supervisor
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
            ? <span className="text-[8px] text-slate-400 font-bold block mt-0.5 ml-1">Ref: {Math.round(v * effectiveRate)} Bs (Tasa BCV)</span>
            : null;
    };

    const formatBlock = (title, colorClass, unitsField, barcodeField, usdField, bsField, unitsPlaceholder) => (
        <div className={`p-3.5 rounded-2xl border space-y-2.5 shadow-sm transition-all ${colorClass}`}>
            <span className="text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5">{title}</span>
            <div className="grid grid-cols-2 gap-2.5">
                <div>
                    <label className={labelCls}>Unidades</label>
                    <input type="number" inputMode="numeric" value={form[unitsField]} onChange={set(unitsField)} placeholder={unitsPlaceholder} className={inputCls} />
                </div>
                <div>
                    <label className={labelCls}><Barcode size={9} /> Cód. Barras</label>
                    <input type="text" value={form[barcodeField]} onChange={set(barcodeField)} placeholder="Escanear..." className={inputCls} />
                </div>
                <div>
                    <label className={labelCls}>Precio USD</label>
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
        <div className="fixed inset-0 z-[300] bg-slate-950/70 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl p-5 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto space-y-4 custom-scrollbar">
                
                {/* Cabecera */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 rounded-2xl flex items-center justify-center shrink-0">
                            {editingProduct ? <Package size={20} /> : <PlusCircle size={20} />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-black text-slate-800 dark:text-white text-sm">
                                    {editingProduct ? 'Editar Producto' : 'Crear Nuevo Producto'}
                                </h3>
                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-300">
                                    Sin Foto • Remoto
                                </span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                                {editingProduct ? 'Los cambios se encolarán para sincronizarse con la caja.' : 'Se añadirá a la lista sin foto. La imagen puede asignarse desde la caja.'}
                            </p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="p-2 rounded-2xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* 1. Datos de Identificación */}
                <div className="space-y-3">
                    <div>
                        <label className={labelCls}>Nombre del Producto *</label>
                        <input 
                            value={form.name} 
                            onChange={set('name')} 
                            placeholder="Ej: Harina Pan 1kg / Pepsi 2lt" 
                            className={`${inputCls} ${!nameOk && form.name ? 'border-amber-400 focus:ring-amber-400/40' : ''}`}
                        />
                        {!nameOk && form.name && (
                            <span className="text-[9px] text-amber-500 font-bold mt-1 block ml-1">Mínimo 3 caracteres</span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                        <div>
                            <label className={labelCls}>Categoría</label>
                            <select value={form.category} onChange={set('category')} className={inputCls}>
                                <option value="">Seleccionar categoría...</option>
                                {(categories || []).filter(c => c.id !== 'todos').map(c => (
                                    <option key={c.id} value={c.id}>{c.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}><Barcode size={10} /> Código de Barras</label>
                            <input value={form.barcode} onChange={set('barcode')} placeholder="Escanear o escribir..." className={inputCls} />
                        </div>
                    </div>
                </div>

                {/* 2. Sección de Precios y Margen de Ganancia */}
                <div className="p-3.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Tag size={11} /> Precio de Unidad
                        </span>
                        {priceNum > 0 && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                                Ganancia: ${profitUsd.toFixed(2)} ({profitPct}%)
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
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
                            <label className={labelCls}>Precio Bs (Manual)</label>
                            <input type="number" inputMode="decimal" value={form.priceBsManual} onChange={set('priceBsManual')} placeholder="0.00 (Opcional)" className={inputCls} />
                            {refBs(form.priceUsd)}
                        </div>
                    </div>
                </div>

                {/* 3. Toggles para Ventas al Mayor (Caja / ½ Caja) */}
                <div className="space-y-2.5 pt-1">
                    {/* Toggle Caja */}
                    <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                            <Layers size={14} className="text-blue-500" />
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

                    {/* Toggle ½ Caja */}
                    <div className={`flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 transition-opacity ${
                        form.sellByBox ? 'opacity-100' : 'opacity-40 cursor-not-allowed'
                    }`}>
                        <div className="flex items-center gap-2">
                            <Layers size={14} className="text-purple-500" />
                            <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                                Vender por ½ Caja {!form.sellByBox && <span className="text-rose-500 text-[10px] normal-case font-bold">(requiere activar Caja)</span>}
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

                {/* 4. Costo / Stock Inicial / Alerta */}
                <div className="grid grid-cols-3 gap-2.5">
                    <div>
                        <label className={labelCls}>Costo USD</label>
                        <input type="number" inputMode="decimal" value={form.costUsd} onChange={set('costUsd')} placeholder="0.00" className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Stock (Uds)</label>
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
                        {editingProduct && <span className="text-[8px] text-slate-400 font-bold block mt-0.5 ml-1">Usa +/- en lista</span>}
                    </div>
                    <div>
                        <label className={`${labelCls} text-amber-500`}><AlertTriangle size={9} /> Mínimo</label>
                        <input type="number" inputMode="numeric" value={form.lowStockAlert} onChange={set('lowStockAlert')} placeholder="5" className={inputCls} />
                    </div>
                </div>

                {/* 5. Botón de Encolado */}
                <div className="pt-2">
                    <button
                        onClick={handleSubmit}
                        disabled={!canSave || sending}
                        className="w-full py-3.5 rounded-2xl font-black text-white uppercase tracking-wider text-xs bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-500/25 transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
