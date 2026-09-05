import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Gift, Search, X, Plus, Minus, Camera, Tag, Percent, Package, CheckCircle, Sparkles, Zap, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Check, Sliders, AlertCircle, Barcode } from 'lucide-react';
import { Modal } from '../Modal';
import ConfirmModal from '../ConfirmModal';
import { calculateComboStock } from '../../utils/productProcessor';
import PricingModeSelector from './PricingModeSelector';
import { calcUsdFromBs, compareBarcodes } from '../../utils/calculatorUtils';
import { showToast } from '../Toast';
import { matchProductSearch } from '../../utils/searchUtils';
import { derivePricingMode } from '../../hooks/useProductForm';

export default function ComboFormModal({
    isOpen,
    onClose,
    products,
    categories,
    effectiveRate,
    bcvRate,
    copEnabled,
    tasaCop,
    onSave,
    editingCombo
}) {
    // ── Estados del Wizard y Formulario ──
    const [currentStep, setCurrentStep] = useState(1); // 1: Datos & Precio | 2: Contenido | 3: Resumen
    const [showExitConfirm, setShowExitConfirm] = useState(false);
    const [showModularChangeConfirm, setShowModularChangeConfirm] = useState(false);
    const [name, setName] = useState('');
    const [image, setImage] = useState(null);
    const [category] = useState('combo');
    const [comboItems, setComboItems] = useState([]); // [{ productId, qty, _product }]
    const [isModular, setIsModular] = useState(false);
    const [modularGroups, setModularGroups] = useState([]); // [{ id, title, requiredQty, allowedProductIds }]
    const [groupSearchTerms, setGroupSearchTerms] = useState({}); // { [groupId]: 'search term' }
    const [pricingMode, setPricingMode] = useState('tasa_dia');
    const [priceUsd, setPriceUsd] = useState('');
    const [priceBsManual, setPriceBsManual] = useState(''); // Precio Bs independiente del combo
    const [priceBsUsdRef, setPriceBsUsdRef] = useState(''); // Precio ref Bs para dual_usd
    const [autoCalc, setAutoCalc] = useState(true); // Auto-Tasa activo por defecto
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [isFormShaking, setIsFormShaking] = useState(false);
    const [barcode, setBarcode] = useState('');
    const [showBarcode, setShowBarcode] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState({}); // { [groupId]: boolean }

    const searchRef = useRef(null);
    const fileInputRef = useRef(null);
    const debounceRef = useRef(null);

    // ── Debounce: actualizar término de búsqueda ──
    const handleSearchChange = useCallback((val) => {
        setSearchTerm(val);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedSearch(val);
        }, 150);
    }, []);

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
    }, []);

    // ── Productos que no son combos ──
    const nonComboProducts = useMemo(() =>
        products?.filter(p => !p.isCombo) || [],
    [products]);

    // ── IDs ya en los ítems fijos del combo ──
    const alreadyAddedIds = useMemo(
        () => new Set(comboItems.map(ci => ci.productId)),
        [comboItems]
    );

    // ── Búsqueda de productos ──
    const searchResults = useMemo(() => {
        if (!debouncedSearch.trim()) return [];
        return nonComboProducts
            .filter(p => !alreadyAddedIds.has(p.id) && matchProductSearch(p, debouncedSearch))
            .slice(0, 8);
    }, [debouncedSearch, nonComboProducts, alreadyAddedIds]);

    // ── Totales acumulados ──
    const individualTotal = useMemo(() =>
        comboItems.reduce((sum, ci) => sum + (ci._product?.priceUsd || 0) * ci.qty, 0),
    [comboItems]);

    const individualTotalBs = useMemo(() =>
        comboItems.reduce((sum, ci) => {
            const p = ci._product;
            if (!p) return sum;
            const unitBs = (p.priceBsManual != null && Number(p.priceBsManual) > 0)
                ? Number(p.priceBsManual)
                : (Number(p.priceUsd) || 0) * effectiveRate;
            return sum + unitBs * ci.qty;
        }, 0),
    [comboItems, effectiveRate]);

    const parsedPrice = parseFloat(priceUsd) || 0;
    const parsedPriceBs = parseFloat(priceBsManual) || 0;
    const savingsUsd = individualTotal > 0 && parsedPrice > 0 ? Math.max(0, individualTotal - parsedPrice) : 0;
    const savingsPct = individualTotal > 0 && parsedPrice > 0 ? ((savingsUsd / individualTotal) * 100) : 0;

    // ── Stock disponible calculado ──
    const availableCombos = useMemo(() => {
        return calculateComboStock(
            { isCombo: true, comboItems, isModular, modularGroups },
            products
        );
    }, [comboItems, isModular, modularGroups, products]);

    // ── Gestores de Grupos Modulares ──
    const addModularGroup = () => {
        const newId = crypto.randomUUID();
        setModularGroups(prev => [
            ...prev,
            {
                id: newId,
                title: `Selección ${prev.length + 1}`,
                requiredQty: 10,
                allowedProductIds: []
            }
        ]);
        // Expandir el nuevo grupo automáticamente
        setCollapsedGroups(prev => ({ ...prev, [newId]: false }));
    };

    const updateModularGroup = (groupId, field, value) => {
        setModularGroups(prev => prev.map(g => g.id === groupId ? { ...g, [field]: value } : g));
    };

    const removeModularGroup = (groupId) => {
        setModularGroups(prev => prev.filter(g => g.id !== groupId));
    };

    const toggleProductInGroup = (groupId, productId) => {
        setModularGroups(prev => prev.map(g => {
            if (g.id !== groupId) return g;
            const exists = (g.allowedProductIds || []).includes(productId);
            return {
                ...g,
                allowedProductIds: exists
                    ? g.allowedProductIds.filter(id => id !== productId)
                    : [...g.allowedProductIds, productId]
            };
        }));
    };

    const toggleGroupCollapse = (groupId) => {
        setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    };

    const prevIsOpenRef = useRef(false);
    const prevEditingComboRef = useRef(null);

    // ── Carga en caso de edición / apertura del modal ──
    useEffect(() => {
        const justOpened = isOpen && !prevIsOpenRef.current;
        const comboChanged = editingCombo !== prevEditingComboRef.current;

        prevIsOpenRef.current = isOpen;
        prevEditingComboRef.current = editingCombo;

        if (!isOpen) return;

        // Solo re-inicializar el formulario si el modal acaba de abrirse o si cambió el objeto editingCombo
        if (!justOpened && !comboChanged) return;

        setCurrentStep(1);
        setShowExitConfirm(false);
        setShowModularChangeConfirm(false);
        if (editingCombo) {
            setName(editingCombo.name || '');
            setImage(editingCombo.image || null);
            const derivedMode = derivePricingMode(editingCombo);
            setPricingMode(derivedMode);
            setPriceUsd(editingCombo.priceUsd ? String(editingCombo.priceUsd) : '');
            setPriceBsManual(editingCombo.priceBsManual ? String(editingCombo.priceBsManual) : '');
            setPriceBsUsdRef(editingCombo.priceBsUsdRef ? String(editingCombo.priceBsUsdRef) : '');
            setBarcode(editingCombo.barcode || '');
            setShowBarcode(Boolean(editingCombo.barcode));
            setIsModular(!!editingCombo.isModular || (editingCombo.modularGroups && editingCombo.modularGroups.length > 0));
            setModularGroups(editingCombo.modularGroups || []);

            let items = [];
            if (editingCombo.comboItems?.length > 0) {
                items = editingCombo.comboItems.map(ci => ({
                    productId: ci.productId,
                    qty: ci.qty,
                    _product: products?.find(p => p.id === ci.productId) || null
                }));
            }
            setComboItems(items);
            setAutoCalc(derivedMode === 'tasa_dia');
        } else {
            setName('');
            setImage(null);
            setComboItems([]);
            setIsModular(false);
            setModularGroups([]);
            setPricingMode('tasa_dia');
            setPriceUsd('');
            setPriceBsManual('');
            setPriceBsUsdRef('');
            setSearchTerm('');
            setBarcode('');
            setShowBarcode(false);
            setCollapsedGroups({});
            setAutoCalc(true);
        }
    }, [isOpen, editingCombo, products]);

    const handleAttemptClose = () => {
        const isDirty = name.trim() || comboItems.length > 0 || modularGroups.length > 0 || parsedPrice > 0;
        if (currentStep > 1 && isDirty) {
            setShowExitConfirm(true);
        } else {
            onClose();
        }
    };

    // ── Modo de Cobro y Auto-Tasa Conversión ──
    const handlePricingModeChange = (mode) => {
        setPricingMode(mode);
        if (mode !== 'tasa_dia') {
            setAutoCalc(false);
        } else {
            setAutoCalc(true);
        }
        if (mode === 'dual_usd' && !priceBsUsdRef && priceUsd) {
            setPriceBsUsdRef(priceUsd);
        }
    };

    const handleToggleAutoCalc = () => {
        const next = !autoCalc;
        setAutoCalc(next);
        if (next && effectiveRate > 0) {
            const usd = parseFloat(priceUsd) || 0;
            if (usd > 0) {
                setPriceBsManual(String(Math.round(usd * effectiveRate)));
            } else {
                const bs = parseFloat(priceBsManual) || 0;
                if (bs > 0) setPriceUsd(calcUsdFromBs(priceBsManual, effectiveRate));
            }
        }
    };

    const handlePriceUsdChange = (val) => {
        setPriceUsd(val);
        if (autoCalc && effectiveRate > 0 && pricingMode === 'tasa_dia') {
            const p = parseFloat(val) || 0;
            setPriceBsManual(p > 0 ? String(Math.round(p * effectiveRate)) : '');
        }
    };

    const handlePriceBsChange = (val) => {
        setPriceBsManual(val);
        if (autoCalc && effectiveRate > 0 && pricingMode === 'tasa_dia') {
            const p = parseFloat(val) || 0;
            setPriceUsd(p > 0 ? calcUsdFromBs(val, effectiveRate) : '');
        }
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 400;
                let w = img.width, h = img.height;
                if (w > h) { if (w > MAX_SIZE) { h *= MAX_SIZE / w; w = MAX_SIZE; } }
                else { if (h > MAX_SIZE) { w *= MAX_SIZE / h; h = MAX_SIZE; } }
                canvas.width = w; canvas.height = h;
                canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                setImage(canvas.toDataURL('image/webp', 0.7));
            };
        };
    };

    const addProduct = (product) => {
        setComboItems(prev => [...prev, { productId: product.id, qty: 1, _product: product }]);
        setSearchTerm('');
        setDebouncedSearch('');
        setIsSearchFocused(false);
    };

    const updateQty = (productId, delta) => {
        setComboItems(prev => prev.map(ci =>
            ci.productId === productId ? { ...ci, qty: Math.max(1, ci.qty + delta) } : ci
        ));
    };

    const removeItem = (productId) => {
        setComboItems(prev => prev.filter(ci => ci.productId !== productId));
    };

    const applyDiscount = (pct) => {
        if (individualTotal <= 0) return;
        const factor = 1 - pct / 100;
        const discountedUsd = String(Math.round(individualTotal * factor * 100) / 100);
        setPriceUsd(discountedUsd);
        if (pricingMode === 'bs_fijo' && individualTotalBs > 0) {
            setPriceBsManual(String(Math.round(individualTotalBs * factor)));
        } else if (pricingMode === 'dual_usd') {
            setPriceBsUsdRef(discountedUsd);
        } else if (autoCalc && effectiveRate > 0) {
            setPriceBsManual(String(Math.round(parseFloat(discountedUsd) * effectiveRate)));
        }
    };

    // ── Validaciones y Navegación del Wizard Reordenado ──
    const hasName = Boolean(name.trim());
    const hasFixedItems = comboItems.length > 0;
    const hasModularItems = isModular && modularGroups.length > 0;
    const hasProducts = hasFixedItems || hasModularItems;
    const parsedPriceBsUsdRef = parseFloat(priceBsUsdRef) || 0;
    const hasValidPrice = parsedPrice > 0 || (pricingMode === 'bs_fijo' && parsedPriceBs > 0);
    const canAdvanceStep1 = hasName && hasProducts;
    const canAdvanceStep2 = hasValidPrice;
    const isFormValid = canAdvanceStep1 && canAdvanceStep2;

    const handleNextStep1 = () => {
        if (!canAdvanceStep1) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return;
        }
        setCurrentStep(2);
    };

    const handleNextStep2 = () => {
        if (!canAdvanceStep2) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return;
        }
        setCurrentStep(3);
    };

    const handleSelectModular = (modular) => {
        if (!modular && isModular && modularGroups.length > 0) {
            setShowModularChangeConfirm(true);
        } else {
            setIsModular(modular);
            if (modular && modularGroups.length === 0) {
                addModularGroup();
            }
        }
    };

    const confirmSwitchToFixed = () => {
        setModularGroups([]);
        setIsModular(false);
        setShowModularChangeConfirm(false);
    };

    const handleSave = () => {
        if (!isFormValid) {
            setIsFormShaking(true);
            setTimeout(() => setIsFormShaking(false), 500);
            return;
        }

        const trimmedBarcode = (barcode || '').trim();
        if (trimmedBarcode && Array.isArray(products)) {
            const currentBarcodes = trimmedBarcode.split(',').map(s => s.trim()).filter(Boolean);
            for (const p of products) {
                if (editingCombo && p.id === editingCombo.id) continue;
                const otherBarcodes = [p.barcode, p.boxBarcode, p.halfBoxBarcode]
                    .map(b => b ? String(b).split(',').map(s => s.trim()) : [])
                    .flat()
                    .filter(Boolean);
                for (const bc of currentBarcodes) {
                    if (otherBarcodes.some(obc => compareBarcodes(obc, bc))) {
                        setIsFormShaking(true);
                        setTimeout(() => setIsFormShaking(false), 500);
                        showToast(`El código de barras "${bc}" ya está asignado al producto "${p.name}" o a uno de sus formatos`, 'warning');
                        return;
                    }
                }
            }
        }

        const formattedName = name.replace(/(^\w{1})|(\s+\w{1})/g, l => l.toUpperCase());
        const cleanItems = comboItems.map(ci => ({ productId: ci.productId, qty: ci.qty }));
        const activeBcvRate = bcvRate || effectiveRate;

        const comboProduct = {
            id: editingCombo?.id || crypto.randomUUID(),
            name: formattedName,
            image,
            category,
            barcode: trimmedBarcode || null,
            priceUsd: parsedPrice,
            priceUsdt: parsedPrice,
            pricingMode,
            forceBcv: pricingMode === 'bcv',
            priceBsManual: pricingMode === 'bs_fijo' && parsedPriceBs > 0 ? parsedPriceBs : null,
            priceBsUsdRef: pricingMode === 'dual_usd' && parsedPriceBsUsdRef > 0 ? parsedPriceBsUsdRef : null,
            priceBs: pricingMode === 'bs_fijo' && parsedPriceBs > 0
                ? parsedPriceBs
                : pricingMode === 'dual_usd' && parsedPriceBsUsdRef > 0
                ? Math.round(parsedPriceBsUsdRef * effectiveRate * 100) / 100
                : Math.round(parsedPrice * (pricingMode === 'bcv' ? activeBcvRate : effectiveRate) * 100) / 100,
            costUsd: 0,
            costBs: 0,
            stock: 0,
            unit: 'unidad',
            isCombo: true,
            isModular: hasModularItems,
            comboItems: cleanItems,
            modularGroups: hasModularItems ? modularGroups.map(g => ({
                id: g.id || crypto.randomUUID(),
                title: g.title || 'Selección',
                requiredQty: Math.max(1, parseInt(g.requiredQty, 10) || 1),
                allowedProductIds: g.allowedProductIds || []
            })) : [],
            lowStockAlert: 0,
            createdAt: editingCombo?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        onSave(comboProduct);
    };

    if (!isOpen) return null;

    return (
        <Modal isOpen={isOpen} onClose={handleAttemptClose} title="" size="max-w-md">
            <div className={`space-y-4 relative ${isFormShaking ? 'animate-[shake_0.5s_ease]' : ''}`}>

                {/* ── Confirmación: Salir sin Guardar ── */}
                <ConfirmModal
                    isOpen={showExitConfirm}
                    onClose={() => setShowExitConfirm(false)}
                    onConfirm={() => { setShowExitConfirm(false); onClose(); }}
                    title="¿Salir sin guardar?"
                    message="Se perderán los datos ingresados en el combo."
                    confirmText="Sí, salir"
                    cancelText="Continuar editando"
                    variant="warning"
                />

                {/* ── Confirmación: Cambiar a Combo Fijo ── */}
                <ConfirmModal
                    isOpen={showModularChangeConfirm}
                    onClose={() => setShowModularChangeConfirm(false)}
                    onConfirm={confirmSwitchToFixed}
                    title="¿Cambiar a Combo Fijo?"
                    message={`Se eliminarán los ${modularGroups.length} grupo(s) de opciones configurados.`}
                    confirmText="Sí, cambiar a Fijo"
                    cancelText="Cancelar"
                    variant="warning"
                />

                {/* ── Cabecera y Indicador del Wizard (Pasos Reordenados) ── */}
                <div className="space-y-3 -mt-2">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-colors ${
                            isModular 
                                ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400' 
                                : 'bg-brand-light/60 dark:bg-surface-800/30 text-brand'
                        }`}>
                            {isModular ? <Sparkles size={20} /> : <Gift size={20} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight truncate">
                                {editingCombo ? 'Editar Combo' : 'Crear Nuevo Combo'}
                            </h3>
                            <p className="text-[11px] text-slate-400 font-bold">
                                {currentStep === 1 && 'Paso 1: Nombre, Foto y Selección de Productos'}
                                {currentStep === 2 && 'Paso 2: Precio de Venta y Modo de Cobro'}
                                {currentStep === 3 && 'Paso 3: Confirmación y Resumen Final'}
                            </p>
                        </div>
                    </div>

                    {/* Barra de Pasos Guiados (Wizard Stepper) */}
                    <div className="flex items-center justify-between gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 text-[10px] font-black">
                        <button
                            type="button"
                            onClick={() => setCurrentStep(1)}
                            className={`flex-1 py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                currentStep === 1
                                    ? 'bg-white dark:bg-slate-700 text-brand shadow-xs'
                                    : canAdvanceStep1
                                    ? 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50'
                                    : 'text-slate-400 opacity-60'
                            }`}
                        >
                            <span className="w-4 h-4 rounded-full bg-brand/10 text-brand flex items-center justify-center text-[9px]">1</span>
                            <span>Productos</span>
                        </button>

                        <ChevronRight size={12} className="text-slate-400 shrink-0" />

                        <button
                            type="button"
                            onClick={() => canAdvanceStep1 && setCurrentStep(2)}
                            disabled={!canAdvanceStep1}
                            className={`flex-1 py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                currentStep === 2
                                    ? 'bg-white dark:bg-slate-700 text-brand shadow-xs'
                                    : canAdvanceStep2
                                    ? 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50'
                                    : 'text-slate-400 opacity-60'
                            }`}
                        >
                            <span className="w-4 h-4 rounded-full bg-brand/10 text-brand flex items-center justify-center text-[9px]">2</span>
                            <span>Precio y Cobro</span>
                        </button>

                        <ChevronRight size={12} className="text-slate-400 shrink-0" />

                        <button
                            type="button"
                            onClick={() => canAdvanceStep1 && canAdvanceStep2 && setCurrentStep(3)}
                            disabled={!canAdvanceStep1 || !canAdvanceStep2}
                            className={`flex-1 py-1.5 px-2 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer ${
                                currentStep === 3
                                    ? 'bg-white dark:bg-slate-700 text-brand shadow-xs'
                                    : isFormValid
                                    ? 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/50'
                                    : 'text-slate-400 opacity-60'
                            }`}
                        >
                            <span className="w-4 h-4 rounded-full bg-brand/10 text-brand flex items-center justify-center text-[9px]">3</span>
                            <span>Resumen</span>
                        </button>
                    </div>
                </div>

                {/* ── PASO 1: NOMBRE, FOTO Y SELECCIÓN DE PRODUCTOS ── */}
                {currentStep === 1 && (
                    <div className="space-y-4 animate-in fade-in duration-200">
                        {/* Selector de Tipo de Combo */}
                        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200/50 dark:border-slate-700/50">
                            <button
                                type="button"
                                onClick={() => handleSelectModular(false)}
                                className={`p-2.5 rounded-xl text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                                    !isModular
                                        ? 'bg-white dark:bg-slate-700 text-brand shadow-sm border border-brand/20'
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                            >
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${!isModular ? 'bg-brand-light text-brand' : 'bg-slate-200 dark:bg-slate-800'}`}>
                                    <Package size={16} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-black leading-tight">Combo Fijo</div>
                                    <div className="text-[9px] text-slate-400 font-medium truncate">Productos fijos</div>
                                </div>
                            </button>

                            <button
                                type="button"
                                onClick={() => handleSelectModular(true)}
                                className={`p-2.5 rounded-xl text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                                    isModular
                                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm shadow-purple-500/20'
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                            >
                                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isModular ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-800'}`}>
                                    <Sparkles size={16} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-xs font-black leading-tight">Con Opciones</div>
                                    <div className="text-[9px] text-purple-200 dark:text-purple-300 font-medium truncate">El cliente elige</div>
                                </div>
                            </button>
                        </div>

                        {/* Foto, Nombre y Código de Barras del Combo */}
                        <div className="space-y-3 bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                            <div className="flex gap-3 items-start">
                                <button type="button" onClick={() => fileInputRef.current?.click()}
                                    className="w-16 h-16 shrink-0 bg-white dark:bg-slate-800 border-2 border-dashed border-brand/30 rounded-xl flex items-center justify-center overflow-hidden hover:border-brand transition-colors shadow-sm mt-1">
                                    {image ? (
                                        <img src={image} className="w-full h-full object-cover" alt="" />
                                    ) : (
                                        <Camera size={20} className="text-brand/60" />
                                    )}
                                </button>
                                <input type="file" ref={fileInputRef} accept="image/*" className="hidden" onChange={handleImageUpload} />
                                <div className="flex-1 space-y-2">
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 ml-1 mb-1 block uppercase tracking-wider">Nombre del Combo</label>
                                        <input
                                            type="text"
                                            value={name}
                                            onChange={e => setName(e.target.value)}
                                            placeholder="Ej: Combo Familiar 3x2"
                                            className="w-full bg-white dark:bg-slate-800 p-2.5 rounded-xl font-bold text-slate-800 dark:text-white outline-none border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-brand/40 transition-all text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black text-slate-400 ml-1 mb-1 block uppercase tracking-wider flex items-center gap-1">
                                            <Barcode size={12} className="text-brand" /> Código de Barras (Opcional)
                                        </label>
                                        <input
                                            type="text"
                                            value={barcode}
                                            onChange={e => setBarcode(e.target.value)}
                                            placeholder="Escanear o ingresar código de barras..."
                                            className="w-full bg-white dark:bg-slate-800 p-2 rounded-xl font-mono font-bold text-slate-800 dark:text-white outline-none border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-brand/40 transition-all text-xs"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Productos Fijos Obligatorios */}
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-black text-slate-400 ml-1 block uppercase flex items-center gap-1.5 tracking-wider">
                                    <Package size={12} /> {isModular ? 'Productos incluidos siempre (Obligatorios)' : 'Productos del combo'}
                                </label>
                                {comboItems.length > 0 && (
                                    <span className="text-[10px] font-black bg-brand-light text-brand px-2 py-0.5 rounded-full">
                                        {comboItems.length} producto{comboItems.length > 1 ? 's' : ''}
                                    </span>
                                )}
                            </div>

                            {/* Buscador de fijos */}
                            <div className="relative">
                                <div className={`flex items-center bg-white dark:bg-slate-900 rounded-2xl border-2 transition-all ${isSearchFocused ? 'border-brand shadow-md shadow-brand/10' : 'border-slate-200 dark:border-slate-800'}`}>
                                    <Search size={14} className={`ml-3 ${isSearchFocused ? 'text-brand' : 'text-slate-400'}`} />
                                    <input
                                        ref={searchRef}
                                        type="text"
                                        value={searchTerm}
                                        onChange={e => handleSearchChange(e.target.value)}
                                        onFocus={() => setIsSearchFocused(true)}
                                        onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                                        placeholder={isModular ? "Buscar producto fijo obligatorio..." : "Buscar producto para añadir al combo..."}
                                        className="flex-1 bg-transparent p-2.5 font-bold text-slate-700 dark:text-white outline-none text-xs placeholder:text-slate-400/60"
                                    />
                                    {searchTerm && (
                                        <button type="button" onClick={() => { setSearchTerm(''); setDebouncedSearch(''); }} className="mr-2 p-1 text-slate-400 hover:text-slate-600">
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>

                                {/* Dropdown de Búsqueda */}
                                {isSearchFocused && searchResults.length > 0 && (
                                    <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl max-h-48 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
                                        {searchResults.map((p) => (
                                            <button key={p.id} type="button"
                                                onMouseDown={(e) => { e.preventDefault(); addProduct(p); }}
                                                className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl hover:bg-brand-light/30 dark:hover:bg-slate-800 transition-all text-left">
                                                <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                                                    {p.image ? <img src={p.image} className="w-full h-full object-cover" alt="" /> : <Tag size={14} className="text-slate-400" />}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-bold text-slate-700 dark:text-white truncate capitalize">{p.name}</div>
                                                    <div className="text-[10px] text-slate-400 font-medium">${p.priceUsd.toFixed(2)} · Stock: {p.stock ?? 0}</div>
                                                </div>
                                                <Plus size={14} className="text-brand shrink-0" strokeWidth={3} />
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Lista de productos fijos */}
                            {comboItems.length > 0 && (
                                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 custom-scrollbar">
                                    {comboItems.map((ci, idx) => {
                                        const p = ci._product;
                                        if (!p) return null;
                                        const subtotal = p.priceUsd * ci.qty;
                                        return (
                                            <div key={ci.productId} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2">
                                                <span className="w-5 h-5 bg-brand-light rounded-md flex items-center justify-center text-[10px] font-black text-brand shrink-0">{idx + 1}</span>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-bold text-slate-800 dark:text-white truncate capitalize">{p.name}</div>
                                                    <div className="text-[10px] text-slate-400 font-medium">${p.priceUsd.toFixed(2)} c/u · <span className="text-brand font-bold">${subtotal.toFixed(2)}</span></div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
                                                    <button type="button" onClick={() => updateQty(ci.productId, -1)} className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-red-500"><Minus size={11} strokeWidth={3} /></button>
                                                    <span className="w-6 text-center text-xs font-black text-brand">{ci.qty}</span>
                                                    <button type="button" onClick={() => updateQty(ci.productId, 1)} className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-brand"><Plus size={11} strokeWidth={3} /></button>
                                                </div>
                                                <button type="button" onClick={() => removeItem(ci.productId)} className="p-1 text-slate-400 hover:text-rose-500 shrink-0"><X size={13} /></button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Grupos de Selección (Solo Combo con Opciones) */}
                            {isModular && (
                                <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                                    <div className="flex items-center justify-between">
                                        <label className="text-[10px] font-black text-slate-400 ml-1 block uppercase flex items-center gap-1.5 tracking-wider">
                                            <Sparkles size={12} className="text-purple-500" /> Grupos de Selección Libre
                                        </label>
                                        <button
                                            type="button"
                                            onClick={addModularGroup}
                                            className="px-2.5 py-1 text-[10px] font-black rounded-xl bg-purple-600 text-white hover:bg-purple-700 transition-all flex items-center gap-1 shadow-xs cursor-pointer"
                                        >
                                            <Plus size={12} strokeWidth={2.5} /> Nuevo Grupo
                                        </button>
                                    </div>

                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                                        {modularGroups.map((g) => {
                                            const allowedIds = g.allowedProductIds || [];
                                            const allowedProds = allowedIds.map(pid => products?.find(p => p.id === pid)).filter(Boolean);
                                            const totalGroupStock = allowedProds.reduce((sum, p) => sum + (p.stock || 0), 0);
                                            const reqQty = parseInt(g.requiredQty, 10) || 1;
                                            const isCoverageOk = totalGroupStock >= reqQty;
                                            const isCollapsed = Boolean(collapsedGroups[g.id]);
                                            const groupSearch = (groupSearchTerms[g.id] || '').toLowerCase().trim();

                                            const filteredAvailable = nonComboProducts.filter(p => {
                                                if (allowedIds.includes(p.id)) return false;
                                                if (!groupSearch) return true;
                                                return matchProductSearch(p, groupSearch);
                                            });

                                            return (
                                                <div key={g.id} className="bg-white dark:bg-slate-900 border border-purple-200/80 dark:border-purple-800/50 rounded-2xl shadow-xs overflow-hidden">
                                                    {/* Acordeón Header */}
                                                    <div className="p-2.5 bg-purple-50/50 dark:bg-purple-950/20 flex items-center gap-2 border-b border-purple-100 dark:border-purple-900/30">
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleGroupCollapse(g.id)}
                                                            className="p-1 text-purple-600 dark:text-purple-400 hover:bg-purple-100 rounded-lg transition-colors"
                                                        >
                                                            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                                                        </button>
                                                        <input
                                                            type="text"
                                                            value={g.title}
                                                            onChange={e => updateModularGroup(g.id, 'title', e.target.value)}
                                                            placeholder="Nombre del grupo (ej: Cervezas)"
                                                            className="flex-1 bg-white dark:bg-slate-800 p-1.5 rounded-xl text-xs font-black text-slate-800 dark:text-white outline-none border border-purple-200/60 dark:border-purple-800"
                                                        />
                                                        <div className="flex items-center gap-1 bg-white dark:bg-slate-800 px-2 py-1 rounded-xl border border-purple-200/60 dark:border-purple-800 shrink-0">
                                                            <span className="text-[9px] font-bold text-slate-400">Elige:</span>
                                                            <input
                                                                type="number" min="1"
                                                                value={g.requiredQty}
                                                                onChange={e => {
                                                                    const val = e.target.value;
                                                                    if (val === '') {
                                                                        updateModularGroup(g.id, 'requiredQty', '');
                                                                    } else {
                                                                        const parsed = parseInt(val, 10);
                                                                        updateModularGroup(g.id, 'requiredQty', isNaN(parsed) ? '' : Math.max(1, parsed));
                                                                    }
                                                                }}
                                                                onBlur={() => {
                                                                    if (!g.requiredQty || parseInt(g.requiredQty, 10) < 1 || isNaN(parseInt(g.requiredQty, 10))) {
                                                                        updateModularGroup(g.id, 'requiredQty', 1);
                                                                    }
                                                                }}
                                                                onFocus={e => e.target.select()}
                                                                onClick={e => e.target.select()}
                                                                className="w-7 text-center text-xs font-black text-purple-600 dark:text-purple-400 outline-none"
                                                            />
                                                            <span className="text-[9px] font-bold text-slate-400">uds</span>
                                                        </div>
                                                        <button type="button" onClick={() => removeModularGroup(g.id)} className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg">
                                                            <X size={14} />
                                                        </button>
                                                    </div>

                                                    {/* Resumen colapsado */}
                                                    {isCollapsed && (
                                                        <div className="px-3 py-1.5 text-[10px] font-bold flex justify-between items-center text-slate-500">
                                                            <span>{allowedProds.length} opciones permitidas</span>
                                                            <span className={isCoverageOk ? 'text-emerald-600' : 'text-amber-600'}>
                                                                Stock: {totalGroupStock} / {g.requiredQty} {isCoverageOk ? '✓' : '⚠️'}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Cuerpo del Acordeón */}
                                                    {!isCollapsed && (
                                                        <div className="p-2.5 space-y-2">
                                                            {allowedProds.length > 0 && (
                                                                <div className="flex flex-wrap gap-1">
                                                                    {allowedProds.map(p => (
                                                                        <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-xl bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[11px] font-bold border border-purple-200">
                                                                            <span className="capitalize">{p.name}</span>
                                                                            <span className="text-[9px] font-black bg-purple-200/80 px-1 rounded text-purple-800">{p.stock ?? 0}</span>
                                                                            <button type="button" onClick={() => toggleProductInGroup(g.id, p.id)} className="hover:text-rose-500 text-purple-400"><X size={11} /></button>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            <div className="relative">
                                                                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                                <input
                                                                    type="text"
                                                                    value={groupSearchTerms[g.id] || ''}
                                                                    onChange={e => setGroupSearchTerms(prev => ({ ...prev, [g.id]: e.target.value }))}
                                                                    placeholder="Buscar producto para este grupo..."
                                                                    className="w-full bg-slate-50 dark:bg-slate-800 pl-7 pr-6 py-1 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 outline-none border border-slate-200/50"
                                                                />
                                                            </div>

                                                            <div className="max-h-24 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                                                {filteredAvailable.slice(0, groupSearch ? 6 : 3).map(p => (
                                                                    <button
                                                                        key={p.id} type="button" onClick={() => toggleProductInGroup(g.id, p.id)}
                                                                        className="w-full flex items-center justify-between p-1 rounded-xl text-left text-xs font-bold bg-slate-50 dark:bg-slate-800/50 hover:bg-purple-50 text-slate-700 dark:text-slate-300 transition-colors"
                                                                    >
                                                                        <span className="truncate capitalize text-[11px]">{p.name}</span>
                                                                        <span className="text-[10px] text-purple-600 font-black shrink-0 ml-2">+ Añadir</span>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Mensaje de validación Paso 1 si faltan productos o nombre */}
                        {!canAdvanceStep1 && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-2.5 rounded-xl text-[10px] font-bold text-amber-700 dark:text-amber-400 space-y-0.5">
                                <div className="flex items-center gap-1.5 font-black"><AlertCircle size={13} className="shrink-0" /> Requiere para continuar:</div>
                                <ul className="list-disc list-inside pl-1 text-[9px]">
                                    {!hasName && <li>Nombre del combo</li>}
                                    {!hasProducts && <li>Al menos 1 producto fijo o grupo de opciones</li>}
                                </ul>
                            </div>
                        )}

                        {/* Footer Paso 1 */}
                        <div className="flex gap-2 pt-2">
                            <button type="button" onClick={handleAttemptClose}
                                className="w-1/3 py-3 rounded-2xl font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs transition-all">
                                Cancelar
                            </button>
                            <button type="button" onClick={handleNextStep1}
                                disabled={!canAdvanceStep1}
                                className="flex-1 py-3 rounded-2xl font-black text-white uppercase tracking-wider text-xs bg-brand hover:bg-brand-dark shadow-md shadow-brand/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                                <span>Siguiente: Definir Precio</span>
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ── PASO 2: FIJAR PRECIO Y MODO DE COBRO ── */}
                {currentStep === 2 && (
                    <div className="space-y-4 animate-in fade-in duration-200">
                        {/* Referencia de Suma de Partes */}
                        <div className="bg-brand-light/40 dark:bg-slate-800/80 border border-brand/20 rounded-2xl p-3 flex items-center justify-between">
                            <div>
                                <span className="text-[9px] font-black uppercase text-brand tracking-wider block">Suma de productos elegidos</span>
                                <span className="text-xs font-black text-slate-800 dark:text-white">
                                    ${individualTotal.toFixed(2)} <span className="text-[10px] text-slate-500 font-bold">/ {individualTotalBs.toFixed(2)} Bs</span>
                                </span>
                            </div>
                            {comboItems.length > 0 && (
                                <span className="text-[10px] font-bold text-slate-500 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                                    {comboItems.length} producto{comboItems.length > 1 ? 's' : ''} fijos
                                </span>
                            )}
                        </div>

                        {/* Precios y Estrategia de Cobro */}
                        <div className="space-y-3 bg-slate-50 dark:bg-slate-900/60 p-3.5 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-black text-slate-400 ml-1 block uppercase tracking-wider flex items-center gap-1">
                                    <Tag size={11} /> ¿Cómo se cobra este combo?
                                </label>
                                {pricingMode === 'tasa_dia' && (
                                    <button
                                        type="button"
                                        onClick={handleToggleAutoCalc}
                                        title={autoCalc ? 'Auto-Tasa activo' : 'Activar cálculo automático Bs'}
                                        className={`flex items-center gap-1 text-[9px] font-black px-2 py-0.5 rounded-lg transition-all ${
                                            autoCalc
                                                ? 'bg-emerald-500 text-white shadow-xs'
                                                : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                                        }`}
                                    >
                                        <Zap size={10} className={autoCalc ? 'fill-white' : ''} /> Auto-Tasa
                                    </button>
                                )}
                            </div>

                            <PricingModeSelector
                                compact
                                value={pricingMode}
                                onChange={handlePricingModeChange}
                                effectiveRate={effectiveRate}
                                bcvRate={bcvRate || effectiveRate}
                            />

                            {/* Entradas de precio condicionadas por el modo */}
                            {pricingMode === 'tasa_dia' && (
                                <div className="grid grid-cols-2 gap-2.5 pt-1">
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio USD ($)</label>
                                        <div className="relative">
                                            <input
                                                type="number" inputMode="decimal"
                                                value={priceUsd}
                                                onChange={e => handlePriceUsdChange(e.target.value)}
                                                placeholder="0.00"
                                                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 rounded-xl font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/40 text-sm"
                                            />
                                            {parsedPrice > 0 && (
                                                <CheckCircle size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand" />
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio Bs</label>
                                        <input
                                            type="number" inputMode="decimal"
                                            value={priceBsManual}
                                            onChange={e => handlePriceBsChange(e.target.value)}
                                            placeholder={parsedPrice > 0 ? (parsedPrice * effectiveRate).toFixed(2) : '0.00'}
                                            className={`w-full p-2 rounded-xl font-black text-sm outline-none border transition-all ${
                                                autoCalc
                                                    ? 'text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20'
                                                    : 'text-slate-800 dark:text-white bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                                            }`}
                                        />
                                    </div>
                                </div>
                            )}

                            {pricingMode === 'bcv' && (
                                <div className="pt-1">
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio USD ($ a Tasa BCV)</label>
                                    <div className="relative">
                                        <input
                                            type="number" inputMode="decimal"
                                            value={priceUsd}
                                            onChange={e => setPriceUsd(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-800 p-2 rounded-xl font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/40 text-sm"
                                        />
                                        {parsedPrice > 0 && (
                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                                                Bs {(parsedPrice * (bcvRate || effectiveRate)).toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {pricingMode === 'dual_usd' && (
                                <div className="grid grid-cols-2 gap-2.5 pt-1">
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">$ Divisas (Efectivo/Zelle)</label>
                                        <input
                                            type="number" inputMode="decimal"
                                            value={priceUsd}
                                            onChange={e => setPriceUsd(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 p-2 rounded-xl font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/40 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">$ Ref (Si paga en Bs)</label>
                                        <input
                                            type="number" inputMode="decimal"
                                            value={priceBsUsdRef}
                                            onChange={e => setPriceBsUsdRef(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-800 p-2 rounded-xl font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/40 text-sm"
                                        />
                                        {parsedPriceBsUsdRef > 0 && (
                                            <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 ml-1 mt-0.5 block">
                                                = {(parsedPriceBsUsdRef * effectiveRate).toFixed(2)} Bs
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {pricingMode === 'bs_fijo' && (
                                <div className="grid grid-cols-2 gap-2.5 pt-1">
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Precio Ref ($)</label>
                                        <input
                                            type="number" inputMode="decimal"
                                            value={priceUsd}
                                            onChange={e => setPriceUsd(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 p-2 rounded-xl font-black text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/40 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Monto Fijo (Bs Congelado)</label>
                                        <input
                                            type="number" inputMode="decimal"
                                            value={priceBsManual}
                                            onChange={e => setPriceBsManual(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700 p-2 rounded-xl font-black text-amber-700 dark:text-amber-400 outline-none focus:ring-2 focus:ring-amber-500/40 text-sm"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Descuentos Rápidos aplicables sobre suma de partes */}
                            {individualTotal > 0 && (
                                <div className="pt-1 border-t border-slate-200/60 dark:border-slate-800">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase">Descuento Rápido s/ Productos</span>
                                        {savingsUsd > 0 && (
                                            <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400">
                                                El cliente ahorra: -${savingsUsd.toFixed(2)} (-{savingsPct.toFixed(0)}%)
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-1">
                                        {[5, 10, 15, 20, 25].map(pct => (
                                            <button key={pct} type="button" onClick={() => applyDiscount(pct)}
                                                className="flex-1 py-1 bg-white dark:bg-slate-800 hover:bg-brand-light text-slate-600 hover:text-brand text-[9px] font-black rounded-lg transition-colors border border-slate-200/60 dark:border-slate-700">
                                                -{pct}%
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Código de barras opcional */}
                            {!showBarcode && !barcode ? (
                                <button
                                    type="button"
                                    onClick={() => setShowBarcode(true)}
                                    className="text-[10px] font-bold text-slate-400 hover:text-brand transition-colors block ml-1"
                                >
                                    ＋ Agregar código de barras (opcional)
                                </button>
                            ) : (
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 ml-1 mb-1 block uppercase">Código de Barras</label>
                                    <input
                                        type="text"
                                        value={barcode}
                                        onChange={e => setBarcode(e.target.value)}
                                        placeholder="Escanear o ingresar..."
                                        className="w-full bg-white dark:bg-slate-800 p-2 rounded-xl font-bold text-slate-700 dark:text-white outline-none border border-slate-200 dark:border-slate-700 text-xs"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Mensaje de validación Paso 2 */}
                        {!canAdvanceStep2 && (
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-2.5 rounded-xl text-[10px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                                <AlertCircle size={13} className="shrink-0" />
                                <span>Ingresa un precio de venta mayor a $0.00 para continuar.</span>
                            </div>
                        )}

                        {/* Footer Paso 2 */}
                        <div className="flex gap-2 pt-2">
                            <button type="button" onClick={() => setCurrentStep(1)}
                                className="w-1/3 py-3 rounded-2xl font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs transition-all flex items-center justify-center gap-1 cursor-pointer">
                                <ChevronLeft size={14} />
                                <span>Atrás</span>
                            </button>
                            <button type="button" onClick={handleNextStep2}
                                disabled={!canAdvanceStep2}
                                className="flex-1 py-3 rounded-2xl font-black text-white uppercase tracking-wider text-xs bg-brand hover:bg-brand-dark shadow-md shadow-brand/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                                <span>Ver Resumen</span>
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ── PASO 3: RESUMEN FINAL Y GUARDAR ── */}
                {currentStep === 3 && (
                    <div className="space-y-4 animate-in fade-in duration-200">
                        {/* Tarjeta de Resumen Visual */}
                        <div className="bg-slate-50 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-xs">
                            <div className="flex items-center gap-3 border-b border-slate-200/60 dark:border-slate-800 pb-3">
                                <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 flex items-center justify-center">
                                    {image ? <img src={image} className="w-full h-full object-cover" alt="" /> : <Gift size={22} className="text-brand" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <h4 className="font-black text-slate-800 dark:text-white text-base truncate capitalize">{name}</h4>
                                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full shrink-0 ${isModular ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300' : 'bg-brand-light text-brand'}`}>
                                            {isModular ? 'Con Opciones' : 'Combo Fijo'}
                                        </span>
                                    </div>
                                    <p className="text-[10px] font-bold text-slate-400">
                                        Modo: {pricingMode === 'tasa_dia' ? '⚡ Tasa del Día' : pricingMode === 'bcv' ? '🏛️ Siempre BCV' : pricingMode === 'dual_usd' ? '💵 Dos Precios en $' : '🔒 Bs Congelado'}
                                    </p>
                                    {barcode && (
                                        <p className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                                            <Barcode size={12} className="text-brand shrink-0" />
                                            <span>{barcode}</span>
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Ficha de Precio y Stock */}
                            <div className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700 space-y-2">
                                <div className="flex justify-between items-center">
                                    <div>
                                        <span className="text-[9px] font-black uppercase text-slate-400 block">Precio de Venta Final</span>
                                        <span className="text-lg font-black text-brand">
                                            ${parsedPrice.toFixed(2)} <span className="text-xs text-slate-500 font-bold">/ {(pricingMode === 'bs_fijo' && parsedPriceBs > 0 ? parsedPriceBs : pricingMode === 'dual_usd' && parsedPriceBsUsdRef > 0 ? parsedPriceBsUsdRef * effectiveRate : parsedPrice * effectiveRate).toFixed(2)} Bs</span>
                                        </span>
                                    </div>
                                    <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${availableCombos > 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-600'}`}>
                                        {availableCombos > 0 ? `⚡ Disponible: ${availableCombos} combos` : '⚠️ Sin stock suficiente'}
                                    </span>
                                </div>
                            </div>

                            {/* Desglose de contenido */}
                            <div className="space-y-1.5 text-xs">
                                <span className="text-[9px] font-black uppercase text-slate-400 block tracking-wider">Contenido Incluido</span>
                                {comboItems.length > 0 && (
                                    <div className="space-y-1">
                                        {comboItems.map((ci) => (
                                            <div key={ci.productId} className="flex justify-between text-slate-700 dark:text-slate-200 font-bold bg-white dark:bg-slate-800 px-2.5 py-1 rounded-lg text-[11px]">
                                                <span className="capitalize">{ci.qty}x {ci._product?.name}</span>
                                                <span className="text-slate-400 font-medium">${((ci._product?.priceUsd || 0) * ci.qty).toFixed(2)}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {isModular && modularGroups.length > 0 && (
                                    <div className="space-y-1 pt-1">
                                        {modularGroups.map((g) => (
                                            <div key={g.id} className="bg-purple-50 dark:bg-purple-950/30 border border-purple-100 dark:border-purple-900/40 p-2 rounded-lg text-[11px] text-purple-900 dark:text-purple-200 font-bold">
                                                <div className="flex justify-between">
                                                    <span>✨ {g.title}</span>
                                                    <span className="text-[10px] text-purple-600 dark:text-purple-400 font-black">Elige: {g.requiredQty} uds</span>
                                                </div>
                                                <div className="text-[9px] font-medium text-purple-600/80 dark:text-purple-300/80 mt-0.5 truncate">
                                                    Opciones: {(g.allowedProductIds || []).map(pid => products?.find(p => p.id === pid)?.name).filter(Boolean).join(', ') || 'Sin opciones'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer Paso 3 */}
                        <div className="flex gap-2 pt-2">
                            <button type="button" onClick={() => setCurrentStep(2)}
                                className="w-1/3 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs transition-all flex items-center justify-center gap-1 cursor-pointer">
                                <ChevronLeft size={14} />
                                <span>Atrás</span>
                            </button>
                            <button type="button" onClick={handleSave}
                                disabled={!isFormValid}
                                className="flex-1 py-3.5 rounded-2xl font-black text-white uppercase tracking-wider text-sm bg-brand hover:bg-brand-dark shadow-lg shadow-brand/20 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                                {editingCombo ? 'Guardar Cambios' : 'Crear Combo'}
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </Modal>
    );
}
