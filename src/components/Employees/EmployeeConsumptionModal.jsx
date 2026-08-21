import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, DollarSign, FileText, Minus, Plus, Receipt, Search, ShoppingBag, UserRound, X } from 'lucide-react';
import { Modal } from '../Modal';
import { showToast } from '../Toast';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { getEmployees, getEmployeePayrollSummary, registerEmployeeConsumption } from '../../services/employeeService';
import { getConsumptionLimitUsd } from '../../utils/employeePayrollModel';
import { mulR, round2, sumR } from '../../utils/dinero';

const formatUsd = value => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
}).format(Number(value) || 0);

const formatBs = value => new Intl.NumberFormat('es-VE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
}).format(Number(value) || 0);

function getProductId(product) {
    return String(product?.id || '');
}

function EmployeeSelect({
    employees = [],
    selectedId = '',
    onSelect,
    disabled = false,
    loading = false,
    triggerHaptic,
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const containerRef = useRef(null);
    const searchInputRef = useRef(null);

    const selectedEmployee = useMemo(() => (
        employees.find(e => e.id === selectedId) || null
    ), [employees, selectedId]);

    const filteredEmployees = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return employees;
        return employees.filter(e => (
            String(e.nombre || '').toLowerCase().includes(query) ||
            String(e.cargo || '').toLowerCase().includes(query) ||
            String(e.cedula || '').toLowerCase().includes(query)
        ));
    }, [employees, search]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') setIsOpen(false);
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleKeyDown);
            setTimeout(() => searchInputRef.current?.focus(), 50);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const getInitials = (name = '') => {
        const parts = name.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return 'EM';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <button
                type="button"
                onClick={() => {
                    if (disabled || loading) return;
                    triggerHaptic?.();
                    setIsOpen(!isOpen);
                    setSearch('');
                }}
                disabled={disabled || loading || employees.length === 0}
                className={`w-full min-h-[50px] rounded-2xl border transition-all flex items-center justify-between gap-3 px-3.5 py-2.5 text-left cursor-pointer outline-none ${
                    isOpen
                        ? 'border-brand ring-4 ring-brand/15 bg-white dark:bg-slate-900 shadow-md'
                        : 'border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-900 hover:border-brand/40 shadow-xs'
                } ${disabled || loading ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.99]'}`}
            >
                {selectedEmployee ? (
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-xl bg-brand/10 dark:bg-brand/20 text-brand font-black text-xs flex items-center justify-center shrink-0 border border-brand/20 shadow-2xs">
                            {getInitials(selectedEmployee.nombre)}
                        </div>
                        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                            <span className="font-black text-sm text-slate-850 dark:text-white truncate">
                                {selectedEmployee.nombre}
                            </span>
                            {selectedEmployee.cargo && (
                                <span className="text-[10.5px] font-bold text-brand bg-brand/10 dark:bg-brand/20 px-2 py-0.5 rounded-lg shrink-0 border border-brand/20">
                                    {selectedEmployee.cargo}
                                </span>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center gap-2.5 text-slate-400 dark:text-slate-500 text-sm font-bold">
                        <UserRound size={17} className="text-slate-400" />
                        <span>{loading ? 'Cargando empleados...' : 'Selecciona un empleado'}</span>
                    </div>
                )}

                <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180 text-brand bg-brand/10' : ''}`}>
                    <ChevronDown size={17} />
                </div>
            </button>

            {/* Dropdown Popover Redondeado con Sombra y Estilo Moderno */}
            {isOpen && (
                <div className="absolute left-0 right-0 top-full mt-2 z-[70] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-700/90 shadow-2xl shadow-slate-900/15 p-2 space-y-1.5 animate-in fade-in zoom-in-95 duration-150 backdrop-blur-md">
                    {employees.length > 3 && (
                        <div className="relative pb-1">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                ref={searchInputRef}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Filtrar empleado..."
                                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 pl-8 pr-3 text-xs font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 text-slate-800 dark:text-slate-100 placeholder:text-slate-400"
                            />
                        </div>
                    )}

                    <div className="max-h-56 overflow-y-auto space-y-1 pr-0.5 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                        {filteredEmployees.map(employee => {
                            const isSelected = employee.id === selectedId;
                            return (
                                <button
                                    key={employee.id}
                                    type="button"
                                    onClick={() => {
                                        triggerHaptic?.();
                                        onSelect(employee.id);
                                        setIsOpen(false);
                                    }}
                                    className={`w-full p-2.5 rounded-xl flex items-center justify-between gap-3 text-left transition-all cursor-pointer ${
                                        isSelected
                                            ? 'bg-brand/10 dark:bg-brand/20 text-brand border border-brand/25 shadow-2xs'
                                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/70 text-slate-700 dark:text-slate-200 border border-transparent'
                                    }`}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <div className={`w-7 h-7 rounded-lg text-xs font-black flex items-center justify-center shrink-0 ${
                                            isSelected
                                                ? 'bg-brand text-white'
                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                        }`}>
                                            {getInitials(employee.nombre)}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className={`text-xs font-black truncate leading-tight ${isSelected ? 'text-brand' : 'text-slate-850 dark:text-white'}`}>
                                                {employee.nombre}
                                            </p>
                                            {employee.cargo && (
                                                <p className="text-[10px] text-slate-400 dark:text-slate-400 font-bold truncate mt-0.5">
                                                    {employee.cargo}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    {isSelected && (
                                        <div className="w-5 h-5 rounded-full bg-brand text-white flex items-center justify-center shrink-0 shadow-2xs">
                                            <Check size={12} strokeWidth={3} />
                                        </div>
                                    )}
                                </button>
                            );
                        })}

                        {filteredEmployees.length === 0 && (
                            <div className="py-6 text-center text-slate-400 text-xs font-bold">
                                No se encontraron empleados
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function EmployeeConsumptionModal({
    isOpen,
    onClose,
    products = [],
    effectiveRate = 0,
    tasaFuente = 'BCV',
    triggerHaptic,
}) {
    const activeUser = useAuthStore(state => state.usuarioActivo);
    const requireLogin = useAuthStore(state => state.requireLogin);
    const isAdmin = activeUser?.rol === 'ADMIN' || requireLogin === false;
    const [employees, setEmployees] = useState([]);
    const [employeeId, setEmployeeId] = useState('');
    const [summary, setSummary] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedItems, setSelectedItems] = useState({});
    const [nota, setNota] = useState('');
    const [overrideLimit, setOverrideLimit] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const requestIdRef = useRef(null);

    const loadEmployees = useCallback(async () => {
        setLoading(true);
        try {
            const list = await getEmployees();
            const active = list.filter(employee => employee.activo);
            setEmployees(active);
            if (!employeeId && active[0]) setEmployeeId(active[0].id);
        } catch (error) {
            showToast(error?.message || 'No se pudieron cargar los empleados', 'error');
        } finally {
            setLoading(false);
        }
    }, [employeeId]);

    const loadSummary = useCallback(async () => {
        if (!employeeId) {
            setSummary(null);
            return;
        }
        try {
            setSummary(await getEmployeePayrollSummary(employeeId));
        } catch (error) {
            setSummary(null);
            showToast(error?.message || 'No se pudo cargar el balance del empleado', 'error');
        }
    }, [employeeId]);

    useEffect(() => {
        if (!isOpen) return;
        setSelectedItems({});
        setSearchTerm('');
        setNota('');
        setOverrideLimit(false);
        setIsSubmitting(false);
        setShowConfirmModal(false);
        requestIdRef.current = null;
        loadEmployees();
    }, [isOpen, loadEmployees]);

    useEffect(() => {
        if (isOpen) loadSummary();
    }, [isOpen, employeeId, loadSummary]);

    useEffect(() => {
        const handleUpdate = () => {
            if (isOpen) {
                loadEmployees();
                loadSummary();
            }
        };
        window.addEventListener('employee-data-updated', handleUpdate);
        window.addEventListener('app_storage_update', handleUpdate);
        return () => {
            window.removeEventListener('employee-data-updated', handleUpdate);
            window.removeEventListener('app_storage_update', handleUpdate);
        };
    }, [isOpen, loadEmployees, loadSummary]);

    const selectedEmployee = useMemo(() => (
        employees.find(e => e.id === employeeId) || null
    ), [employees, employeeId]);

    const filteredProducts = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        return products
            .filter(product => !product?.isCombo)
            .filter(product => !query
                || String(product.name || '').toLowerCase().includes(query)
                || String(product.barcode || '').toLowerCase().includes(query))
            .slice(0, 30);
    }, [products, searchTerm]);

    const draftItems = useMemo(() => Object.entries(selectedItems)
        .map(([productId, qty]) => {
            const product = products.find(item => getProductId(item) === productId);
            return product ? { product, qty: Number(qty) || 0 } : null;
        })
        .filter(item => item && item.qty > 0), [products, selectedItems]);

    const draftTotalUsd = useMemo(() => sumR(draftItems.map(item => (
        mulR(Number(item.product.priceUsd || 0), item.qty)
    ))), [draftItems]);

    const draftTotalBs = useMemo(() => (
        effectiveRate > 0 ? mulR(draftTotalUsd, effectiveRate) : 0
    ), [draftTotalUsd, effectiveRate]);

    const projectedTotalUsd = round2((summary?.totalConsumosUsd || 0) + draftTotalUsd);
    const limitUsd = summary?.limiteConsumoUsd ?? (getConsumptionLimitUsd(employees.find(item => item.id === employeeId) || {}));
    const exceedsLimit = projectedTotalUsd > limitUsd;
    const remainingUsd = round2((summary?.salarioSemanalUsd || 0) - projectedTotalUsd);

    const updateQuantity = (product, delta) => {
        const productId = getProductId(product);
        const current = Number(selectedItems[productId] || 0);
        const next = Math.max(0, current + delta);
        const stock = Number(product.stock) || 0;
        if (next > stock) {
            showToast(`Stock insuficiente para ${product.name}`, 'warning');
            triggerHaptic?.();
            return;
        }
        setSelectedItems(previous => {
            const nextItems = { ...previous };
            if (next === 0) delete nextItems[productId];
            else nextItems[productId] = next;
            return nextItems;
        });
    };

    const handleQuantityInput = (product, value) => {
        const parsed = Number(value);
        const next = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        const stock = Number(product.stock) || 0;
        if (next > stock) {
            showToast(`Stock máximo disponible: ${stock}`, 'warning');
            return;
        }
        const productId = getProductId(product);
        setSelectedItems(previous => {
            const nextItems = { ...previous };
            if (next === 0) delete nextItems[productId];
            else nextItems[productId] = next;
            return nextItems;
        });
    };

    // Abre el modal de confirmación con el resumen
    const handleOpenConfirm = () => {
        if (!employeeId || draftItems.length === 0 || isSubmitting) return;
        if (exceedsLimit && !overrideLimit) {
            showToast('El consumo supera el límite semanal. Autoriza la excepción o reduce la cantidad.', 'warning');
            triggerHaptic?.();
            return;
        }
        triggerHaptic?.();
        setShowConfirmModal(true);
    };

    // Ejecuta el registro definitivo del consumo
    const handleExecuteConfirm = async () => {
        if (!employeeId || draftItems.length === 0 || isSubmitting) return;
        setIsSubmitting(true);
        triggerHaptic?.();
        requestIdRef.current ||= `employee_consumption_request_${crypto.randomUUID()}`;
        try {
            const result = await registerEmployeeConsumption({
                employeeId,
                items: draftItems.map(item => ({ productId: item.product.id, qty: item.qty })),
                nota,
                tasaBsPorUsd: effectiveRate,
                tasaFuente,
                overrideLimit,
                idempotencyKey: requestIdRef.current,
            });
            if (!result.success) {
                showToast(result.error || 'El consumo quedó pendiente de recuperación', 'error');
                return;
            }
            showToast(`Consumo registrado por ${formatUsd(result.consumption.totalUsd)} para ${selectedEmployee?.nombre || 'el empleado'}`, 'success');
            window.dispatchEvent(new CustomEvent('employee-data-updated'));
            setSelectedItems({});
            setNota('');
            setOverrideLimit(false);
            setShowConfirmModal(false);
            requestIdRef.current = null;
            await loadSummary();
            onClose?.();
        } catch (error) {
            showToast(error?.message || 'No se pudo registrar el consumo', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <Modal isOpen={isOpen} onClose={onClose} title="Consumo Personal" size="max-w-4xl">
                <div className="space-y-4 text-slate-800 dark:text-slate-100">
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-4">
                        <section className="space-y-3">
                            <div className="rounded-2xl bg-brand-light/60 dark:bg-brand/10 border border-brand/20 p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <UserRound size={18} className="text-brand" />
                                    <h4 className="font-black">Empleado</h4>
                                </div>
                                <EmployeeSelect
                                    employees={employees}
                                    selectedId={employeeId}
                                    onSelect={(id) => {
                                        setEmployeeId(id);
                                        setSelectedItems({});
                                    }}
                                    disabled={loading || employees.length === 0}
                                    loading={loading}
                                    triggerHaptic={triggerHaptic}
                                />
                            </div>

                            <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-4">
                                <div className="flex items-center justify-between gap-2 mb-3">
                                    <span className="text-xs font-black uppercase tracking-wider text-slate-400">Balance semanal</span>
                                    <span className="text-xs font-bold text-slate-500">{summary?.periodoId || '—'}</span>
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold">Salario</p>
                                        <p className="text-sm font-black">{formatUsd(summary?.salarioSemanalUsd)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold">Consumido</p>
                                        <p className="text-sm font-black text-amber-600">{formatUsd(projectedTotalUsd)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-slate-400 font-bold">Saldo</p>
                                        <p className={`text-sm font-black ${remainingUsd < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                            {formatUsd(remainingUsd)}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-4 h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                    <div
                                        className={`h-full transition-all ${exceedsLimit ? 'bg-rose-500' : 'bg-brand'}`}
                                        style={{ width: `${Math.min(100, limitUsd > 0 ? (projectedTotalUsd / limitUsd) * 100 : 0)}%` }}
                                    />
                                </div>
                                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                                    Límite: {formatUsd(limitUsd)} · Nuevo consumo: {formatUsd(draftTotalUsd)}
                                </p>
                                {exceedsLimit && (
                                    <div className="mt-3 flex gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-300">
                                        <AlertTriangle size={16} className="shrink-0" />
                                        <span>El total supera el límite configurado.</span>
                                    </div>
                                )}
                                {exceedsLimit && isAdmin && (
                                    <label className="mt-3 flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer">
                                        <input type="checkbox" checked={overrideLimit} onChange={event => setOverrideLimit(event.target.checked)} />
                                        Autorizar excepción como ADMIN
                                    </label>
                                )}
                            </div>
                        </section>

                        <section className="min-w-0 space-y-3">
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    value={searchTerm}
                                    onChange={event => setSearchTerm(event.target.value)}
                                    placeholder="Buscar producto o escanear código..."
                                    className="w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                                    autoFocus
                                />
                            </div>
                            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                                {filteredProducts.map(product => {
                                    const productId = getProductId(product);
                                    const quantity = Number(selectedItems[productId] || 0);
                                    const stock = Number(product.stock) || 0;
                                    return (
                                        <div key={productId} className={`flex items-center gap-3 rounded-2xl border p-3 ${quantity > 0 ? 'border-brand/40 bg-brand-light/30 dark:bg-brand/10' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'}`}>
                                            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden">
                                                {product.image ? <img src={product.image} alt="" className="w-full h-full object-contain" /> : <ShoppingBag size={18} className="text-slate-400" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-black truncate">{product.name}</p>
                                                <p className="text-[11px] text-slate-400">{formatUsd(product.priceUsd)} · Stock {stock}</p>
                                            </div>
                                            <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                                                <button type="button" aria-label={`Quitar ${product.name}`} onClick={() => updateQuantity(product, -1)} disabled={quantity <= 0} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 disabled:opacity-30"><Minus size={14} /></button>
                                                <input
                                                    value={quantity || ''}
                                                    placeholder="0"
                                                    onChange={event => handleQuantityInput(product, event.target.value)}
                                                    className="w-9 bg-transparent text-center text-xs font-black outline-none"
                                                    inputMode="decimal"
                                                />
                                                <button type="button" aria-label={`Agregar ${product.name}`} onClick={() => updateQuantity(product, 1)} disabled={quantity >= stock} className="w-7 h-7 rounded-lg flex items-center justify-center text-brand disabled:opacity-30"><Plus size={14} /></button>
                                            </div>
                                        </div>
                                    );
                                })}
                                {filteredProducts.length === 0 && <p className="py-8 text-center text-xs font-bold text-slate-400">No hay productos disponibles.</p>}
                            </div>
                        </section>
                    </div>

                    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/60">
                            <div>
                                <p className="text-xs font-black uppercase tracking-wider">Resumen del consumo</p>
                                <p className="text-[11px] text-slate-400">{draftItems.length} producto(s) seleccionado(s)</p>
                            </div>
                            <div className="text-right">
                                <p className="text-xl font-black text-brand">{formatUsd(draftTotalUsd)}</p>
                                {effectiveRate > 0 && draftTotalBs > 0 && (
                                    <p className="text-[11px] font-bold text-slate-400">Bs. {formatBs(draftTotalBs)}</p>
                                )}
                            </div>
                        </div>
                        <div className="px-4 py-3 space-y-3">
                            {draftItems.length > 0 && (
                                <div className="space-y-1">
                                    {draftItems.map(item => (
                                        <div key={getProductId(item.product)} className="flex justify-between gap-3 text-xs">
                                            <span className="font-bold truncate">{item.qty} × {item.product.name}</span>
                                            <span className="font-black">{formatUsd(mulR(item.product.priceUsd, item.qty))}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <textarea value={nota} onChange={event => setNota(event.target.value)} placeholder="Nota opcional..." rows={2} className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs outline-none resize-none" />
                        </div>
                    </section>

                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={onClose} disabled={isSubmitting} className="flex-1 min-h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-sm font-black cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
                            <X size={16} className="inline mr-1" /> Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={handleOpenConfirm}
                            disabled={!employeeId || draftItems.length === 0 || isSubmitting || (exceedsLimit && !overrideLimit)}
                            className="flex-[1.5] min-h-12 rounded-xl bg-brand text-white text-sm font-black shadow-lg shadow-brand/20 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand-dark transition-all cursor-pointer"
                        >
                            <CheckCircle2 size={17} className="inline mr-1" /> Confirmar Consumo
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Modal de Confirmación con Resumen Completo */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-[999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full shadow-2xl space-y-5 animate-scale-in max-h-[90vh] flex flex-col">
                        <div className="flex items-center gap-3">
                            <div className="w-11 h-11 rounded-2xl bg-brand/10 dark:bg-brand/20 text-brand flex items-center justify-center font-black shrink-0 border border-brand/20">
                                <Receipt size={22} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-base font-black text-slate-850 dark:text-white leading-tight">¿Confirmar Consumo?</h3>
                                <p className="text-xs font-bold text-slate-400">Verifica el desglose antes de registrar la deducción.</p>
                            </div>
                        </div>

                        {/* Tarjeta de Empleado */}
                        <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="w-8 h-8 rounded-xl bg-brand text-white text-xs font-black flex items-center justify-center shrink-0 shadow-2xs">
                                    {String(selectedEmployee?.nombre || '?').slice(0, 2).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="text-xs font-black text-slate-850 dark:text-white truncate">{selectedEmployee?.nombre}</p>
                                    <p className="text-[10px] text-slate-400 font-bold truncate">{selectedEmployee?.cargo || 'Personal'} · {summary?.periodoId || 'Período Actual'}</p>
                                </div>
                            </div>
                            <div className="text-right shrink-0 pl-2">
                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Total</span>
                                <span className="text-sm font-black text-brand">{formatUsd(draftTotalUsd)}</span>
                            </div>
                        </div>

                        {/* Desglose de Productos */}
                        <div className="space-y-1.5 flex-1 overflow-y-auto pr-1 max-h-44 scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-700">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 px-1">
                                Artículos a descontar ({draftItems.length})
                            </p>
                            <div className="space-y-1">
                                {draftItems.map(item => {
                                    const itemTotalUsd = mulR(Number(item.product.priceUsd || 0), item.qty);
                                    const itemTotalBs = effectiveRate > 0 ? mulR(itemTotalUsd, effectiveRate) : 0;
                                    return (
                                        <div key={getProductId(item.product)} className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 text-xs">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold text-slate-800 dark:text-slate-100 truncate">{item.qty} × {item.product.name}</p>
                                                <p className="text-[10.5px] text-slate-400 font-medium">PU: {formatUsd(item.product.priceUsd)}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="font-black text-slate-800 dark:text-white">{formatUsd(itemTotalUsd)}</p>
                                                {effectiveRate > 0 && <p className="text-[10px] text-slate-400 font-bold">Bs. {formatBs(itemTotalBs)}</p>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Impacto en Balance de Nómina */}
                        <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 space-y-1.5 text-xs">
                            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                                <span className="font-bold text-[11px]">Salario Semanal:</span>
                                <span className="font-black text-slate-800 dark:text-white">{formatUsd(summary?.salarioSemanalUsd)}</span>
                            </div>
                            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                                <span className="font-bold text-[11px]">Consumos Previos:</span>
                                <span className="font-bold text-amber-600">{formatUsd(summary?.totalConsumosUsd || 0)}</span>
                            </div>
                            <div className="flex justify-between items-center text-slate-600 dark:text-slate-300 pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
                                <span className="font-black text-slate-800 dark:text-white">Este Consumo:</span>
                                <div className="text-right">
                                    <span className="font-black text-brand text-sm">{formatUsd(draftTotalUsd)}</span>
                                    {effectiveRate > 0 && draftTotalBs > 0 && (
                                        <span className="text-[10px] font-bold text-slate-400 block">Bs. {formatBs(draftTotalBs)}</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
                                <span className="font-black text-slate-800 dark:text-white">Saldo Neto Restante:</span>
                                <span className={`font-black text-sm ${remainingUsd < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {formatUsd(remainingUsd)}
                                </span>
                            </div>
                        </div>

                        {/* Nota opcional */}
                        {nota && (
                            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 text-xs">
                                <span className="text-[10px] font-black text-slate-400 block uppercase tracking-wider">Nota:</span>
                                <p className="text-slate-700 dark:text-slate-200 italic mt-0.5">"{nota}"</p>
                            </div>
                        )}

                        {/* Botones de Acción */}
                        <div className="flex gap-3 pt-1">
                            <button
                                type="button"
                                onClick={() => setShowConfirmModal(false)}
                                disabled={isSubmitting}
                                className="flex-1 py-3 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                            >
                                Modificar
                            </button>
                            <button
                                type="button"
                                onClick={handleExecuteConfirm}
                                disabled={isSubmitting}
                                className="flex-[1.5] py-3 px-4 bg-brand hover:bg-brand-dark text-white font-black text-xs rounded-2xl shadow-lg shadow-brand/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                                {isSubmitting ? (
                                    <span>Registrando...</span>
                                ) : (
                                    <>
                                        <CheckCircle2 size={16} />
                                        <span>Confirmar y Descontar</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
