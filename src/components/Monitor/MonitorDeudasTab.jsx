import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
    BookOpen, Search, User, Phone, MessageCircle, ChevronDown, ChevronUp,
    CheckCircle2, Wallet, ArrowUpRight, ArrowDownRight, X, RotateCcw,
    ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Users
} from 'lucide-react';
import { formatUsd, formatBs, formatCop } from '../../utils/calculatorUtils';
import { supabaseCloud } from '../../config/supabaseCloud';
import { showToast as defaultShowToast } from '../Toast';
import { createSupervisorCommandId } from '../../utils/supervisorCommandModel';

export default function MonitorDeudasTab({
    customers = [],
    sales = [],
    effectiveRate = 0,
    bcvRate = 0,
    tasaCop = 0,
    copEnabled = false,
    copPrimary = false,
    triggerHaptic = () => {},
    pairedDeviceId = null,
    supervisorUser = null,
    showToast: propShowToast = null
}) {
    // Tasa de cambio activa seleccionada en el sistema
    const activeRate = Number(effectiveRate) > 0 ? Number(effectiveRate) : (Number(bcvRate) || 0);

    const [searchTerm, setSearchTerm] = useState('');
    const [filterType, setFilterType] = useState('all'); // 'all' | 'deuda' | 'favor' | 'aldia'
    const [expandedCustomerId, setExpandedCustomerId] = useState(null);
    const [selectedCustomerForHistory, setSelectedCustomerForHistory] = useState(null);
    const [resetModalCustomer, setResetModalCustomer] = useState(null);
    const [isResetting, setIsResetting] = useState(false);

    // ── Paginación Inteligente ──
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(15);
    const tableTopRef = useRef(null);

    // Métricas globales de Clientes
    const metrics = useMemo(() => {
        const validCustomers = Array.isArray(customers) ? customers : [];

        let totalFiadoUsd = 0;
        let totalFavorUsd = 0;
        let debtorsCount = 0;
        let favorCount = 0;
        let zeroBalanceCount = 0;

        validCustomers.forEach(c => {
            const deuda = Number(c.deuda) || 0;
            const favor = Number(c.favor) || 0;
            if (deuda > 0.01) {
                totalFiadoUsd += deuda;
                debtorsCount++;
            } else if (favor > 0.01) {
                totalFavorUsd += favor;
                favorCount++;
            } else {
                zeroBalanceCount++;
            }
        });

        return {
            totalFiadoUsd,
            totalFavorUsd,
            netBalanceUsd: totalFiadoUsd - totalFavorUsd,
            debtorsCount,
            favorCount,
            zeroBalanceCount,
            totalCustomers: validCustomers.length
        };
    }, [customers]);

    // Filtrar y ordenar clientes (Prioridad: Mayor Deuda primero, luego Saldo a Favor, luego Alfabético)
    const filteredCustomers = useMemo(() => {
        const validCustomers = Array.isArray(customers) ? customers : [];
        return validCustomers
            .filter(c => {
                const name = String(c.name || c.nombre || '').toLowerCase();
                const phone = String(c.phone || c.telefono || '');
                const code = String(c.code || c.codigo || c.cedula || '').toLowerCase();
                const term = searchTerm.toLowerCase().trim();

                const matchesSearch = !term || name.includes(term) || phone.includes(term) || code.includes(term);
                if (!matchesSearch) return false;

                const deuda = Number(c.deuda) || 0;
                const favor = Number(c.favor) || 0;

                if (filterType === 'deuda') return deuda > 0.01;
                if (filterType === 'favor') return favor > 0.01;
                if (filterType === 'aldia') return deuda <= 0.01 && favor <= 0.01;
                if (filterType === 'all') return true; // Mostrar todos los clientes
                return true;
            })
            .sort((a, b) => {
                const deudaA = Number(a.deuda) || 0;
                const deudaB = Number(b.deuda) || 0;
                // 1. Mayor Deuda primero
                if (deudaB > 0.01 || deudaA > 0.01) {
                    if (Math.abs(deudaB - deudaA) > 0.001) return deudaB - deudaA;
                }

                // 2. Mayor Saldo a Favor después
                const favorA = Number(a.favor) || 0;
                const favorB = Number(b.favor) || 0;
                if (favorB > 0.01 || favorA > 0.01) {
                    if (Math.abs(favorB - favorA) > 0.001) return favorB - favorA;
                }

                // 3. Alfabético por nombre
                const nameA = String(a.name || a.nombre || '').toLowerCase();
                const nameB = String(b.name || b.nombre || '').toLowerCase();
                return nameA.localeCompare(nameB);
            });
    }, [customers, searchTerm, filterType]);

    // ── Reseteo de Página al Filtrar o Buscar ──
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterType, itemsPerPage]);

    // ── Cálculo de Paginación Inteligente ──
    const effectiveItemsPerPage = itemsPerPage === 'all' ? (filteredCustomers.length || 1) : Number(itemsPerPage);
    const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / effectiveItemsPerPage));
    const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

    const paginatedCustomers = useMemo(() => {
        if (itemsPerPage === 'all') return filteredCustomers;
        const startIdx = (validCurrentPage - 1) * effectiveItemsPerPage;
        return filteredCustomers.slice(startIdx, startIdx + effectiveItemsPerPage);
    }, [filteredCustomers, validCurrentPage, effectiveItemsPerPage, itemsPerPage]);

    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= totalPages) {
            triggerHaptic?.();
            setCurrentPage(newPage);
            if (tableTopRef.current) {
                tableTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    };

    const getPageNumbers = (current, total) => {
        if (total <= 5) {
            return Array.from({ length: total }, (_, i) => i + 1);
        }
        if (current <= 3) {
            return [1, 2, 3, 4, '...', total];
        }
        if (current >= total - 2) {
            return [1, '...', total - 3, total - 2, total - 1, total];
        }
        return [1, '...', current - 1, current, current + 1, '...', total];
    };

    // Obtener historial completo de ventas, fiados y abonos de un cliente
    const getCustomerSalesHistory = (customer) => {
        if (!customer || !Array.isArray(sales)) return [];
        const customerId = typeof customer === 'object' ? (customer.id || customer._id) : customer;
        const customerName = typeof customer === 'object' ? String(customer.name || customer.nombre || '').toLowerCase().trim() : '';
        const customerPhone = typeof customer === 'object' ? String(customer.phone || customer.telefono || '').replace(/[^\d]/g, '') : '';

        return sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (customerId && (s.customerId === customerId || s.clienteId === customerId || s.cliente === customerId)) return true;
            if (customerName) {
                const sClient = String(s.clientName || s.customerName || s.cliente || '').toLowerCase().trim();
                if (sClient && (sClient === customerName || sClient.includes(customerName) || customerName.includes(sClient))) return true;
            }
            if (customerPhone && customerPhone.length >= 7) {
                const sPhone = String(s.clientPhone || s.customerPhone || s.phone || '').replace(/[^\d]/g, '');
                if (sPhone && sPhone.includes(customerPhone)) return true;
            }
            return false;
        }).sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date));
    };

    // Formatear enlace de WhatsApp
    const getWhatsAppUrl = (phone, customerName, deudaUsd) => {
        if (!phone) return null;
        let clean = phone.replace(/[^\d]/g, '');
        if (clean.startsWith('0')) clean = '58' + clean.slice(1);
        if (!clean.startsWith('58')) clean = '58' + clean;
        const bsText = activeRate > 0 ? ` (${formatBs(deudaUsd * activeRate)} Bs)` : '';
        const msg = encodeURIComponent(`Hola ${customerName}, te saludamos de Comercializadora Donde Juancho. Te recordamos tu saldo pendiente por pagar de $${formatUsd(deudaUsd)} USD${bsText}. ¡Gracias por tu preferencia!`);
        return `https://wa.me/${clean}?text=${msg}`;
    };

    // Reiniciar saldo a $0 desde el Monitor de Supervisión
    const handleConfirmResetBalance = async () => {
        const customer = resetModalCustomer;
        if (!customer) return;
        triggerHaptic && triggerHaptic();
        setIsResetting(true);

        const toast = propShowToast || defaultShowToast;
        const targetPrimary = pairedDeviceId || (typeof localStorage !== 'undefined' ? localStorage.getItem('dj_paired_device_id') : null);
        const myDeviceId = (typeof localStorage !== 'undefined' ? localStorage.getItem('dj_device_id') : null) || 'mon_supervisor_admin';

        if (!targetPrimary) {
            toast && toast('No hay una caja emparejada para aplicar el comando.', 'error');
            setIsResetting(false);
            return;
        }

        try {
            const commandId = typeof createSupervisorCommandId === 'function' ? createSupervisorCommandId() : crypto.randomUUID();

            // 1. Encolar comando supervisor en Supabase
            if (supabaseCloud) {
                const { error: cmdErr } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert({
                        id: commandId,
                        primary_device_id: targetPrimary,
                        monitor_device_id: myDeviceId,
                        command_type: 'inventory_update',
                        status: 'pending',
                        payload: {
                            action: 'update_customer_balance',
                            commandId,
                            customerId: customer.id,
                            customerCode: customer.code,
                            deuda: 0,
                            favor: 0,
                            customer: {
                                id: customer.id,
                                code: customer.code,
                                deuda: 0,
                                favor: 0,
                                casheaDeuda: 0
                            },
                            supervisorId: supervisorUser?.id || null,
                            supervisorName: supervisorUser?.nombre || 'Supervisor',
                            supervisorRole: supervisorUser?.rol || 'SUPERVISOR',
                            reason: `Reinicio de saldo a $0.00 desde Monitor para ${customer.name || customer.code}`
                        }
                    });

                if (cmdErr) {
                    console.error('[MonitorDeudasTab] Error al encolar comando en Supabase:', cmdErr);
                }
            }

            // 2. Actualizar optimistamente en el almacenamiento del monitor
            const updatedCustomer = { ...customer, deuda: 0, favor: 0, casheaDeuda: 0, updatedAt: new Date().toISOString() };
            const nextCustomers = customers.map(c => 
                (c.id === customer.id || (customer.code && c.code === customer.code)) ? updatedCustomer : c
            );

            const { storageService } = await import('../../utils/storageService');
            await storageService.setItem('bodega_customers_v1', nextCustomers);

            // 3. Actualizar directamente sync_documents en la nube
            if (supabaseCloud) {
                try {
                    await supabaseCloud
                        .from('sync_documents')
                        .update({
                            data: { payload: nextCustomers },
                            payload: { payload: nextCustomers },
                            updated_at: new Date().toISOString()
                        })
                        .eq('device_id', targetPrimary)
                        .eq('doc_id', 'bodega_customers_v1');
                } catch (syncErr) {
                    console.warn('[MonitorDeudasTab] No se pudo actualizar sync_documents directamente:', syncErr);
                }
            }

            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_customers_v1' } }));

            toast && toast(`Saldo reiniciado a $0.00 para ${customer.name || customer.code}`, 'success');
            setResetModalCustomer(null);
            if (selectedCustomerForHistory && selectedCustomerForHistory.id === customer.id) {
                setSelectedCustomerForHistory(updatedCustomer);
            }
        } catch (err) {
            console.error('[MonitorDeudasTab] Error al reiniciar saldo:', err);
            toast && toast('Error al reiniciar saldo del cliente', 'error');
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-in fade-in pb-12 w-full max-w-full overflow-x-hidden">
            {/* Header Principal */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 rounded-3xl shadow-sm">
                <div>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 flex items-center justify-center">
                            <BookOpen size={18} />
                        </div>
                        <h3 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">
                            Cuentas por Cobrar & Fiados
                        </h3>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                        Auditoría en tiempo real de saldos fiados, abonos de clientes y saldo a favor.
                    </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <span className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span>{metrics.debtorsCount} {metrics.debtorsCount === 1 ? 'deudor activo' : 'deudores activos'}</span>
                    </span>
                </div>
            </div>

            {/* Tarjetas KPI Superiores (3 Columnas Balanceadas - 100% Responsivas) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-4">
                {/* 1. Total Fiado */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-red-200/80 dark:border-red-900/40 shadow-sm relative overflow-hidden flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-red-600 dark:text-red-400 truncate">
                            Total Fiado
                        </span>
                        <div className="w-7 h-7 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 flex items-center justify-center shrink-0">
                            <ArrowDownRight size={15} />
                        </div>
                    </div>
                    <div className="font-outfit text-xl sm:text-2xl lg:text-3xl font-black text-red-600 dark:text-red-400 tabular-nums">
                        ${formatUsd(metrics.totalFiadoUsd)}
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-1 flex items-center justify-between">
                        <span>{activeRate > 0 ? `~${formatBs(metrics.totalFiadoUsd * activeRate)} Bs` : 'Sin tasa'}</span>
                        <span className="text-red-500/80">{metrics.debtorsCount} {metrics.debtorsCount === 1 ? 'deudor' : 'deudores'}</span>
                    </div>
                </div>

                {/* 2. Saldo a Favor */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-900/40 shadow-sm relative overflow-hidden flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 truncate">
                            Saldo a Favor
                        </span>
                        <div className="w-7 h-7 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center shrink-0">
                            <ArrowUpRight size={15} />
                        </div>
                    </div>
                    <div className="font-outfit text-xl sm:text-2xl lg:text-3xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                        +${formatUsd(metrics.totalFavorUsd)}
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-1 flex items-center justify-between">
                        <span>{activeRate > 0 ? `~${formatBs(metrics.totalFavorUsd * activeRate)} Bs` : 'Sin tasa'}</span>
                        <span className="text-emerald-600/80">{metrics.favorCount} {metrics.favorCount === 1 ? 'cliente' : 'clientes'}</span>
                    </div>
                </div>

                {/* 3. Balance Neto */}
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm relative overflow-hidden flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 truncate">
                            Balance Neto
                        </span>
                        <div className="w-7 h-7 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
                            <Wallet size={15} />
                        </div>
                    </div>
                    <div className="font-outfit text-xl sm:text-2xl lg:text-3xl font-black text-slate-800 dark:text-white tabular-nums">
                        ${formatUsd(metrics.netBalanceUsd)}
                    </div>
                    <div className="text-[11px] font-bold text-slate-400 mt-1 flex items-center justify-between">
                        <span>{activeRate > 0 ? `~${formatBs(metrics.netBalanceUsd * activeRate)} Bs` : 'Por recuperar neto'}</span>
                        <span className="text-slate-400">Neto en calle</span>
                    </div>
                </div>
            </div>

            {/* Barra de Filtros y Búsqueda */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-3 sm:p-4 rounded-3xl shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                    {/* Buscador */}
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Buscar cliente, cédula o teléfono..."
                            className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl text-xs sm:text-sm font-medium text-slate-800 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-brand/40 transition-all"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm('')}
                                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Selector de Filtros Pills (Grid 4 columnas responsivo) */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 w-full sm:w-auto shrink-0">
                        <button
                            type="button"
                            onClick={() => { setFilterType('all'); triggerHaptic(); }}
                            className={`px-2 sm:px-3 py-2 rounded-xl text-[10.5px] sm:text-xs font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer text-center truncate ${
                                filterType === 'all'
                                    ? 'bg-brand text-white shadow-sm shadow-brand/20'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            <span className="truncate">Todos ({metrics.totalCustomers})</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => { setFilterType('deuda'); triggerHaptic(); }}
                            className={`px-2 sm:px-3 py-2 rounded-xl text-[10.5px] sm:text-xs font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer text-center truncate ${
                                filterType === 'deuda'
                                    ? 'bg-red-500 text-white shadow-sm shadow-red-500/20'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"></span>
                            <span className="truncate">Deudores ({metrics.debtorsCount})</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => { setFilterType('favor'); triggerHaptic(); }}
                            className={`px-2 sm:px-3 py-2 rounded-xl text-[10.5px] sm:text-xs font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer text-center truncate ${
                                filterType === 'favor'
                                    ? 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                            <span className="truncate">A Favor ({metrics.favorCount})</span>
                        </button>

                        <button
                            type="button"
                            onClick={() => { setFilterType('aldia'); triggerHaptic(); }}
                            className={`px-2 sm:px-3 py-2 rounded-xl text-[10.5px] sm:text-xs font-black transition-all flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer text-center truncate ${
                                filterType === 'aldia'
                                    ? 'bg-slate-700 dark:bg-slate-600 text-white shadow-sm'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                        >
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
                            <span className="truncate">Al Día ({metrics.zeroBalanceCount})</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* SECCIÓN CLIENTES (MOBILE CARDS + DESKTOP TABLE) */}
            <div ref={tableTopRef} className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                            {filterType === 'deuda' ? 'Clientes con Deuda Activa (Fiados)' : filterType === 'favor' ? 'Clientes con Saldo a Favor' : filterType === 'aldia' ? 'Clientes al Día (Saldo $0)' : 'Todos los Clientes Registrados'}
                        </h4>
                        <span className="text-[11px] font-bold text-slate-400">
                            {filteredCustomers.length === 0 ? '0 clientes' : (
                                itemsPerPage === 'all' 
                                    ? `${filteredCustomers.length} cliente(s)`
                                    : `Mostrando ${(validCurrentPage - 1) * effectiveItemsPerPage + 1}–${Math.min(validCurrentPage * effectiveItemsPerPage, filteredCustomers.length)} de ${filteredCustomers.length} cliente(s)`
                            )}
                        </span>
                    </div>

                    {/* Selector de Items por Página */}
                    <div className="flex items-center gap-1.5 self-end sm:self-auto bg-slate-50 dark:bg-slate-800/60 p-1 rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                        <span className="text-[10px] font-bold text-slate-400 px-1.5">Ver:</span>
                        {[15, 30, 50, 'all'].map((size) => (
                            <button
                                key={size}
                                type="button"
                                onClick={() => {
                                    triggerHaptic?.();
                                    setItemsPerPage(size);
                                }}
                                className={`px-2 py-1 rounded-lg text-[10.5px] font-black transition-all cursor-pointer ${
                                    itemsPerPage === size
                                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-2xs'
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                }`}
                            >
                                {size === 'all' ? 'Todos' : size}
                            </button>
                        ))}
                    </div>
                </div>

                {filteredCustomers.length === 0 ? (
                    <div className="p-12 text-center text-slate-400 space-y-2">
                        <CheckCircle2 size={32} className="mx-auto text-emerald-500 opacity-60" />
                        <p className="text-xs font-bold">No hay clientes que coincidan con la búsqueda o filtro.</p>
                    </div>
                ) : (
                    <>
                        {/* VISTA MÓVIL (< 768px): Tarjetas Touch Anti-Colapso */}
                        <div className="divide-y divide-slate-100 dark:divide-slate-800 md:hidden">
                            {paginatedCustomers.map(c => {
                                const deuda = Number(c.deuda) || 0;
                                const favor = Number(c.favor) || 0;
                                const isDeudor = deuda > 0.01;
                                const isFavor = favor > 0.01;
                                const isExpanded = expandedCustomerId === c.id;
                                const customerSales = isExpanded ? getCustomerSalesHistory(c) : [];
                                const waUrl = getWhatsAppUrl(c.phone, c.name, deuda);

                                return (
                                    <div key={c.id} className="p-3.5 sm:p-4 space-y-3">
                                        {/* Cabecera Tarjeta Móvil */}
                                        <div className="flex items-start justify-between gap-2.5">
                                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                <div className={`w-9 h-9 rounded-2xl flex items-center justify-center font-black text-xs shrink-0 ${
                                                    isDeudor 
                                                        ? 'bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400' 
                                                        : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400'
                                                }`}>
                                                    {String(c.name || '?').slice(0, 1).toUpperCase()}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <h5 className="text-xs sm:text-sm font-black text-slate-800 dark:text-white capitalize truncate">
                                                             {c.name}
                                                        </h5>
                                                        {c.code && (
                                                            <span className="text-[9px] font-mono font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded-md shrink-0">
                                                                {c.code}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {c.phone ? (
                                                        <p className="text-[10px] text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                                                            <Phone size={10} />
                                                            <span>{c.phone}</span>
                                                        </p>
                                                    ) : (
                                                        <p className="text-[10px] text-slate-400 italic mt-0.5">Sin teléfono registrado</p>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Monto Destacado */}
                                            <div className="text-right shrink-0">
                                                {isDeudor && (
                                                    <>
                                                        <span className="font-outfit text-sm sm:text-base font-black text-red-600 dark:text-red-400 block leading-tight tabular-nums">
                                                            -${formatUsd(deuda)}
                                                        </span>
                                                        {activeRate > 0 && (
                                                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 block mt-0.5">
                                                                -{formatBs(deuda * activeRate)} Bs
                                                            </span>
                                                        )}
                                                    </>
                                                )}
                                                {isFavor && (
                                                    <>
                                                        <span className="font-outfit text-sm sm:text-base font-black text-emerald-600 dark:text-emerald-400 block leading-tight tabular-nums">
                                                            +${formatUsd(favor)}
                                                        </span>
                                                        <span className="text-[10px] font-bold text-emerald-600/80 block mt-0.5">
                                                            Saldo a Favor
                                                        </span>
                                                    </>
                                                )}
                                                {!isDeudor && !isFavor && (
                                                    <span className="inline-block px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[10.5px] font-bold text-slate-500">
                                                        Al Día
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Acciones de la Tarjeta Móvil */}
                                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/60">
                                            <div className="flex items-center gap-1.5">
                                                {waUrl && (
                                                    <a
                                                        href={waUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold flex items-center gap-1 transition-all"
                                                    >
                                                        <MessageCircle size={13} />
                                                        <span>Cobrar WhatsApp</span>
                                                    </a>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        triggerHaptic();
                                                        setSelectedCustomerForHistory(c);
                                                    }}
                                                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
                                                >
                                                    <BookOpen size={12} />
                                                    <span>Historial</span>
                                                </button>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => {
                                                    triggerHaptic();
                                                    setExpandedCustomerId(isExpanded ? null : c.id);
                                                }}
                                                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                            >
                                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                            </button>
                                        </div>

                                        {/* Historial Desplegable Rápido en Móvil */}
                                        {isExpanded && (
                                            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-2xl border border-slate-200/60 dark:border-slate-800 space-y-2 animate-in fade-in">
                                                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">
                                                    Historial de Movimientos:
                                                </span>

                                                {customerSales.length === 0 ? (
                                                    <p className="text-[11px] text-slate-400 italic">No hay tickets sincronizados para este cliente.</p>
                                                ) : (
                                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                                        {customerSales.map(s => {
                                                            const isFiada = s.tipo === 'VENTA_FIADA';
                                                            const isCobro = s.tipo === 'COBRO_DEUDA';
                                                            const dateStr = s.timestamp ? new Date(s.timestamp).toLocaleDateString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

                                                            return (
                                                                <div key={s.id} className="p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-200/50 dark:border-slate-800 flex items-start justify-between gap-2 text-[11px]">
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase ${
                                                                                isFiada ? 'bg-red-100 dark:bg-red-950/40 text-red-600' :
                                                                                isCobro ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600' :
                                                                                'bg-slate-100 text-slate-600'
                                                                            }`}>
                                                                                {isFiada ? 'Venta Fiada' : isCobro ? 'Abono Recibido' : 'Venta Contado'}
                                                                            </span>
                                                                            <span className="text-[9.5px] text-slate-400 font-mono">{dateStr}</span>
                                                                        </div>

                                                                        {/* Items */}
                                                                        {Array.isArray(s.items) && s.items.length > 0 && (
                                                                            <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                                                                                {s.items.map(i => `${i.qty}x ${i.name || i.productName}`).join(', ')}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    <div className="text-right shrink-0">
                                                                        <span className={`font-outfit font-black text-xs ${
                                                                            isFiada ? 'text-red-600 dark:text-red-400' :
                                                                            isCobro ? 'text-emerald-600 dark:text-emerald-400' :
                                                                            'text-slate-700 dark:text-slate-200'
                                                                        }`}>
                                                                            {isFiada ? `-$${formatUsd(s.totalUsd)}` : `+$${formatUsd(s.totalUsd)}`}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* VISTA ESCRITORIO (≥ 768px): Tabla Estilizada */}
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-slate-100 dark:border-slate-800 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                        <th className="py-3 px-4">Cliente / Código</th>
                                        <th className="py-3 px-3">Teléfono / Contacto</th>
                                        <th className="py-3 px-3 text-right">Deuda (USD)</th>
                                        <th className="py-3 px-3 text-right">Equivalente (Bs)</th>
                                        <th className="py-3 px-3 text-right">Saldo a Favor</th>
                                        <th className="py-3 px-4 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                                    {paginatedCustomers.map(c => {
                                        const deuda = Number(c.deuda) || 0;
                                        const favor = Number(c.favor) || 0;
                                        const isDeudor = deuda > 0.01;
                                        const isFavor = favor > 0.01;
                                        const waUrl = getWhatsAppUrl(c.phone, c.name, deuda);

                                        return (
                                            <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                                <td className="py-3 px-4 whitespace-nowrap">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${
                                                            isDeudor ? 'bg-red-100 text-red-600' : isFavor ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                                                        }`}>
                                                            {String(c.name || '?').slice(0, 1).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <span className="font-black text-slate-800 dark:text-white capitalize block">
                                                                {c.name}
                                                            </span>
                                                            <span className="text-[10px] font-mono text-slate-400">
                                                                {c.code || 'S/C'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="py-3 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono">
                                                    {c.phone ? (
                                                        <span className="flex items-center gap-1">
                                                            <Phone size={12} className="text-slate-400" />
                                                            {c.phone}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-300 dark:text-slate-600 italic">—</span>
                                                    )}
                                                </td>

                                                <td className="py-3 px-3 text-right font-black font-outfit text-sm text-red-600 dark:text-red-400 tabular-nums whitespace-nowrap">
                                                    {isDeudor ? `-$${formatUsd(deuda)}` : '—'}
                                                </td>

                                                <td className="py-3 px-3 text-right font-bold text-slate-600 dark:text-slate-300 tabular-nums whitespace-nowrap">
                                                    {isDeudor && activeRate > 0 ? `-${formatBs(deuda * activeRate)} Bs` : '—'}
                                                </td>

                                                <td className="py-3 px-3 text-right font-black font-outfit text-sm text-emerald-600 dark:text-emerald-400 tabular-nums whitespace-nowrap">
                                                    {isFavor ? `+$${formatUsd(favor)}` : '—'}
                                                </td>

                                                <td className="py-3 px-4 text-center whitespace-nowrap">
                                                    <div className="flex items-center justify-center gap-1.5">
                                                        {waUrl && (
                                                            <a
                                                                href={waUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                title="Contactar por WhatsApp"
                                                                className="p-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 transition-colors"
                                                            >
                                                                <MessageCircle size={14} />
                                                            </a>
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                triggerHaptic();
                                                                setSelectedCustomerForHistory(c);
                                                            }}
                                                            className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                                                        >
                                                            Historial
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                triggerHaptic();
                                                                setResetModalCustomer(c);
                                                            }}
                                                            title="Reiniciar saldo a $0 (Modo Supervisor)"
                                                            className="px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1 transition-colors cursor-pointer"
                                                        >
                                                            <RotateCcw size={12} className="text-amber-600 dark:text-amber-400" />
                                                            <span>Ajustar $0</span>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Controles de Paginación Inteligente */}
                        {totalPages > 1 && itemsPerPage !== 'all' && (
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 bg-slate-50/50 dark:bg-slate-850/50 border-t border-slate-100 dark:border-slate-800">
                                {/* Indicador de Página */}
                                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                    Página <span className="font-black text-slate-800 dark:text-white">{validCurrentPage}</span> de <span className="font-black text-slate-800 dark:text-white">{totalPages}</span>
                                </div>

                                {/* Botones de Navegación */}
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => handlePageChange(1)}
                                        disabled={validCurrentPage === 1}
                                        title="Primera Página"
                                        className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                                    >
                                        <ChevronsLeft size={16} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handlePageChange(validCurrentPage - 1)}
                                        disabled={validCurrentPage === 1}
                                        title="Página Anterior"
                                        className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>

                                    {/* Botones Numéricos de Página */}
                                    <div className="hidden sm:flex items-center gap-1 mx-1">
                                        {getPageNumbers(validCurrentPage, totalPages).map((p, idx) => {
                                            if (p === '...') {
                                                return <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 font-bold">…</span>;
                                            }
                                            const isCurrent = p === validCurrentPage;
                                            return (
                                                <button
                                                    key={`page-${p}`}
                                                    type="button"
                                                    onClick={() => handlePageChange(p)}
                                                    className={`min-w-[32px] h-8 px-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                                                        isCurrent
                                                            ? 'bg-brand text-white shadow-sm shadow-brand/20'
                                                            : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                                    }`}
                                                >
                                                    {p}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => handlePageChange(validCurrentPage + 1)}
                                        disabled={validCurrentPage === totalPages}
                                        title="Página Siguiente"
                                        className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                                    >
                                        <ChevronRight size={16} />
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => handlePageChange(totalPages)}
                                        disabled={validCurrentPage === totalPages}
                                        title="Última Página"
                                        className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                                    >
                                        <ChevronsRight size={16} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Modal de Historial Detallado del Cliente (Desktop / Modal) */}
            {selectedCustomerForHistory && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]">
                        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
                            <div>
                                <h4 className="text-sm sm:text-base font-black text-slate-800 dark:text-white capitalize">
                                    Historial: {selectedCustomerForHistory.name}
                                </h4>
                                <p className="text-[11px] text-slate-400 font-mono">
                                    Deuda: ${formatUsd(selectedCustomerForHistory.deuda || 0)} · Saldo: ${formatUsd(selectedCustomerForHistory.favor || 0)}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        triggerHaptic();
                                        setResetModalCustomer(selectedCustomerForHistory);
                                    }}
                                    className="px-2.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold flex items-center gap-1 shadow-sm shadow-amber-500/20 transition-all cursor-pointer"
                                >
                                    <RotateCcw size={12} />
                                    <span>Reiniciar $0</span>
                                </button>
                                <button
                                    onClick={() => setSelectedCustomerForHistory(null)}
                                    className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors cursor-pointer"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        <div className="p-4 sm:p-5 overflow-y-auto space-y-3 flex-1">
                            {getCustomerSalesHistory(selectedCustomerForHistory.id).length === 0 ? (
                                <p className="text-center py-8 text-xs text-slate-400 font-bold">No hay transacciones registradas para este cliente.</p>
                            ) : (
                                getCustomerSalesHistory(selectedCustomerForHistory.id).map(s => {
                                    const isFiada = s.tipo === 'VENTA_FIADA';
                                    const isCobro = s.tipo === 'COBRO_DEUDA';
                                    const dateStr = s.timestamp ? new Date(s.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';

                                    return (
                                        <div key={s.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200/60 dark:border-slate-700/60 flex items-start justify-between gap-3 text-xs">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`px-2 py-0.5 rounded-md text-[9.5px] font-black uppercase ${
                                                        isFiada ? 'bg-red-100 text-red-700' :
                                                        isCobro ? 'bg-emerald-100 text-emerald-700' :
                                                        'bg-slate-200 text-slate-700'
                                                    }`}>
                                                        {isFiada ? 'Venta Fiada' : isCobro ? 'Abono Recibido' : 'Venta Contado'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 font-mono">{dateStr}</span>
                                                </div>

                                                {Array.isArray(s.items) && s.items.length > 0 && (
                                                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1.5 font-medium">
                                                        {s.items.map(i => `${i.qty}x ${i.name || i.productName} ($${formatUsd(i.priceUsd || 0)})`).join(', ')}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="text-right shrink-0">
                                                <span className={`font-outfit font-black text-sm block ${
                                                    isFiada ? 'text-red-600 dark:text-red-400' :
                                                    isCobro ? 'text-emerald-600 dark:text-emerald-400' :
                                                    'text-slate-800 dark:text-white'
                                                }`}>
                                                    {isFiada ? `-$${formatUsd(s.totalUsd)}` : `+$${formatUsd(s.totalUsd)}`}
                                                </span>
                                                {activeRate > 0 && (
                                                    <span className="text-[10px] font-bold text-slate-400 block">
                                                        {formatBs(s.totalBs || (s.totalUsd * activeRate))} Bs
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-right">
                            <button
                                onClick={() => setSelectedCustomerForHistory(null)}
                                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación: Reiniciar Saldo a $0 (Modo Supervisor) */}
            {resetModalCustomer && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden p-5 sm:p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                                <RotateCcw size={20} />
                            </div>
                            <div>
                                <h4 className="text-base font-black text-slate-800 dark:text-white">
                                    Reiniciar Saldo a $0.00
                                </h4>
                                <p className="text-xs text-slate-400">
                                    Comando remoto de Supervisor
                                </p>
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-2 text-xs">
                            <div className="flex justify-between items-center">
                                <span className="text-slate-500">Cliente:</span>
                                <span className="font-black text-slate-800 dark:text-white capitalize">
                                    {resetModalCustomer.name} ({resetModalCustomer.code || 'S/C'})
                                </span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-slate-500">Saldo actual:</span>
                                <span className={`font-black font-outfit ${Number(resetModalCustomer.deuda) > 0 ? 'text-red-600' : Number(resetModalCustomer.favor) > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                                    {Number(resetModalCustomer.deuda) > 0 ? `Deuda -$${formatUsd(resetModalCustomer.deuda)}` : Number(resetModalCustomer.favor) > 0 ? `A Favor +$${formatUsd(resetModalCustomer.favor)}` : '$0.00'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center pt-1 border-t border-slate-200 dark:border-slate-700">
                                <span className="text-slate-500 font-bold">Nuevo saldo resultante:</span>
                                <span className="font-black font-outfit text-emerald-600 text-sm">$0.00 USD</span>
                            </div>
                        </div>

                        <p className="text-[11px] text-slate-400 leading-relaxed">
                            Se enviará un comando supervisor a la caja principal para actualizar permanentemente la memoria de la PDA y la nube.
                        </p>

                        <div className="flex items-center justify-end gap-2.5 pt-2">
                            <button
                                type="button"
                                disabled={isResetting}
                                onClick={() => setResetModalCustomer(null)}
                                className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                disabled={isResetting}
                                onClick={handleConfirmResetBalance}
                                className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-50"
                            >
                                {isResetting ? (
                                    <>
                                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        <span>Enviando comando...</span>
                                    </>
                                ) : (
                                    <>
                                        <RotateCcw size={14} />
                                        <span>Confirmar Reinicio a $0</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
