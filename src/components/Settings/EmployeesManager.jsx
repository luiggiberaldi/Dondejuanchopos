import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BriefcaseBusiness, Check, Download, FileText, History, Pencil, Plus, Printer, RotateCcw, UserMinus, Users, X, Trash2 } from 'lucide-react';
import UserSelectDropdown from '../Employees/UserSelectDropdown';
import { showToast } from '../Toast';
import ConfirmModal from '../ConfirmModal';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { printThermalTicket } from '../../utils/ticketGenerator';
import { getActivePaymentMethods } from '../../config/paymentMethods';
import { generateEmployeePayrollPDF } from '../../utils/employeePayrollPdfGenerator';
import {
    deactivateEmployee,
    deleteEmployee,
    getEmployeeHistory,
    getEmployeePayrollSummary,
    getEmployees,
    getPayrollSettlements,
    settleEmployeePayroll,
    saveEmployee,
    voidEmployeeConsumption,
    voidEmployeePayrollSettlement,
} from '../../services/employeeService';

const EMPTY_FORM = {
    nombre: '',
    cargo: '',
    userId: '',
    usuarioNombre: '',
    salarioSemanalUsd: '',
    limiteConsumoPorc: '100',
};

const formatUsd = value => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
}).format(Number(value) || 0);

export default function EmployeesManager({ triggerHaptic, effectiveRate = 0, bcvRate = 0 }) {
    const usuarioActivo = useAuthStore(state => state.usuarioActivo);
    const storeUsuarios = useAuthStore(state => state.usuarios) || [];
    const [syncedUsers, setSyncedUsers] = useState(() => {
        try {
            const raw = localStorage.getItem('bodega_users_catalog_v1');
            const arr = raw ? JSON.parse(raw) : null;
            if (Array.isArray(arr) && arr.length > 0) return arr;
        } catch {}
        return null;
    });

    useEffect(() => {
        const handleSync = () => {
            try {
                const raw = localStorage.getItem('bodega_users_catalog_v1');
                const arr = raw ? JSON.parse(raw) : null;
                if (Array.isArray(arr) && arr.length > 0) setSyncedUsers(arr);
            } catch {}
        };
        window.addEventListener('app_storage_update', handleSync);
        window.addEventListener('storage', handleSync);
        return () => {
            window.removeEventListener('app_storage_update', handleSync);
            window.removeEventListener('storage', handleSync);
        };
    }, []);

    const usuarios = useMemo(() => {
        const list = (storeUsuarios && storeUsuarios.length > 0 && storeUsuarios.some(u => u.nombre !== 'Administrador' && u.nombre !== 'Cajero'))
            ? storeUsuarios 
            : ((syncedUsers && syncedUsers.length > 0) ? syncedUsers : storeUsuarios);
        return (list || []).map(u => ({
            ...u,
            rol: u.rol || (u.id === 1 ? 'ADMIN' : 'CAJERO'),
        }));
    }, [syncedUsers, storeUsuarios]);

    const requireLogin = useAuthStore(state => state.requireLogin);
    const isAdmin = usuarioActivo?.rol === 'ADMIN' || requireLogin === false;
    const [employees, setEmployees] = useState([]);
    const [summaries, setSummaries] = useState({});
    const [form, setForm] = useState(EMPTY_FORM);
    const [editingId, setEditingId] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [historyEmployee, setHistoryEmployee] = useState(null);
    const [history, setHistory] = useState([]);
    const [settlementHistory, setSettlementHistory] = useState([]);
    const [historySummary, setHistorySummary] = useState(null);
    const [settlementEmployee, setSettlementEmployee] = useState(null);
    const [settlementSummary, setSettlementSummary] = useState(null);
    const [settlementMethods, setSettlementMethods] = useState([]);
    const [settlementMethod, setSettlementMethod] = useState('efectivo_usd');
    const [settlementCurrency, setSettlementCurrency] = useState('USD');
    const [settlementNote, setSettlementNote] = useState('');
    const [receiptSettlement, setReceiptSettlement] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [exportingPdf, setExportingPdf] = useState(false);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', confirmText: 'Confirmar', variant: 'danger', onConfirm: null });
    const employeesRef = useRef(employees);
    useEffect(() => {
        employeesRef.current = employees;
    }, [employees]);

    const loadEmployees = useCallback(async (silent = false) => {
        if (!silent && employeesRef.current.length === 0) {
            setLoading(true);
        }
        try {
            const list = await getEmployees();

            // Cargar balances y resúmenes de cada empleado antes de renderizar para evitar saltos
            const summariesMap = {};
            await Promise.all(list.map(async emp => {
                try {
                    const sum = await getEmployeePayrollSummary(emp.id);
                    summariesMap[emp.id] = sum;
                } catch (_) {}
            }));

            // Actualización atómica en el mismo ciclo de render
            setSummaries(summariesMap);
            setEmployees(list);
        } catch (error) {
            showToast(error?.message || 'No se pudieron cargar los empleados', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isAdmin) loadEmployees();
    }, [isAdmin, loadEmployees]);

    useEffect(() => {
        const handleUpdate = () => { if (isAdmin) loadEmployees(true); };
        window.addEventListener('employee-data-updated', handleUpdate);
        return () => {
            window.removeEventListener('employee-data-updated', handleUpdate);
        };
    }, [isAdmin, loadEmployees]);

    const activeEmployees = useMemo(() => employees.filter(employee => employee.activo), [employees]);

    const startCreate = () => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setShowForm(true);
    };

    const startEdit = (employee, e) => {
        e?.stopPropagation?.();
        setEditingId(employee.id);
        setForm({
            nombre: employee.nombre || '',
            cargo: employee.cargo || '',
            userId: employee.userId !== undefined && employee.userId !== null ? String(employee.userId) : '',
            usuarioNombre: employee.usuarioNombre || '',
            salarioSemanalUsd: String(employee.salarioSemanalUsd ?? ''),
            limiteConsumoPorc: String(employee.limiteConsumoPorc ?? 100),
        });
        setShowForm(true);
    };

    const handleUserChange = selectedUser => {
        if (!selectedUser) {
            setForm(prev => ({ ...prev, userId: '', usuarioNombre: '' }));
            return;
        }
        setForm(prev => ({
            ...prev,
            userId: selectedUser.id,
            usuarioNombre: selectedUser.nombre,
            // Si el nombre está vacío, autocompletar con el nombre del usuario
            nombre: prev.nombre.trim() === '' ? selectedUser.nombre : prev.nombre,
            // Si el cargo está vacío, sugerir según su rol
            cargo: prev.cargo.trim() === '' ? (selectedUser.rol === 'ADMIN' ? 'Administrador' : 'Cajero') : prev.cargo,
        }));
    };

    const submitEmployee = async event => {
        event.preventDefault();
        if (!isAdmin || saving) return;
        setSaving(true);
        try {
            await saveEmployee({
                id: editingId || undefined,
                ...form,
                userId: form.userId ? form.userId : null,
                usuarioNombre: form.usuarioNombre || null,
                salarioSemanalUsd: Number(form.salarioSemanalUsd),
                limiteConsumoPorc: Number(form.limiteConsumoPorc),
            });
            showToast(editingId ? 'Empleado actualizado' : 'Empleado creado', 'success');
            triggerHaptic?.();
            setShowForm(false);
            setForm(EMPTY_FORM);
            setEditingId(null);
            await loadEmployees();
            window.dispatchEvent(new CustomEvent('employee-data-updated'));
        } catch (error) {
            showToast(error?.message || 'No se pudo guardar el empleado', 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async (employee, e) => {
        e?.stopPropagation?.();
        if (!isAdmin) return;
        if (!window.confirm(`¿Desactivar a ${employee.nombre}? El historial de consumos y nómina se conservará intacto.`)) {
            return;
        }
        try {
            await deactivateEmployee(employee.id);
            showToast('Empleado desactivado', 'success');
            await loadEmployees();
        } catch (error) {
            showToast(error?.message || 'No se pudo desactivar el empleado', 'error');
        }
    };

    const handleDeleteEmployee = (employee, e) => {
        e?.stopPropagation?.();
        if (!isAdmin) {
            showToast('Solo el Administrador puede eliminar empleados', 'error');
            return;
        }

        // Paso 1 de 2: Primera confirmación
        setConfirmModal({
            isOpen: true,
            title: '¿Eliminar Empleado? (Paso 1 de 2)',
            message: `¿Estás seguro de que deseas eliminar al empleado "${employee.nombre}" (${employee.cargo || 'Personal'})?\n\nEsta acción preparará la eliminación definitiva de su registro.`,
            confirmText: 'Continuar (Paso 2)',
            variant: 'danger',
            onConfirm: () => {
                // Paso 2 de 2: Segunda confirmación definitiva
                setTimeout(() => {
                    setConfirmModal({
                        isOpen: true,
                        title: '⚠️ Confirmación Final (Paso 2 de 2)',
                        message: `¡ATENCIÓN: ESTA ACCIÓN ES TOTALMENTE DEFINITIVA E IRREVERSIBLE!\n\n¿Confirmas que deseas BORRAR PERMANENTEMENTE a "${employee.nombre}" del sistema?`,
                        confirmText: 'Sí, Eliminar Definitivamente',
                        variant: 'danger',
                        onConfirm: async () => {
                            setConfirmModal(prev => ({ ...prev, isOpen: false }));
                            try {
                                await deleteEmployee(employee.id);
                                showToast(`Empleado "${employee.nombre}" eliminado definitivamente`, 'success');
                                triggerHaptic?.();
                                await loadEmployees();
                                window.dispatchEvent(new CustomEvent('employee-data-updated'));
                            } catch (error) {
                                showToast(error?.message || 'No se pudo eliminar el empleado', 'error');
                            }
                        }
                    });
                }, 150);
            }
        });
    };

    const openHistory = async employee => {
        setHistoryEmployee(employee);
        setHistory([]);
        setSettlementHistory([]);
        setHistorySummary(summaries[employee.id] || null);
        try {
            const [items, summary] = await Promise.all([
                getEmployeeHistory(employee.id),
                getEmployeePayrollSummary(employee.id),
            ]);
            const settlements = await getPayrollSettlements({
                employeeId: employee.id,
                periodoId: summary.periodoId,
            });
            setHistory(items);
            setSettlementHistory(settlements);
            setHistorySummary(summary);
        } catch (error) {
            showToast(error?.message || 'No se pudo cargar el historial', 'error');
        }
    };

    const handleDownloadPDF = async (employee, summary, consumptions, settlements) => {
        if (!employee || exportingPdf) return;
        setExportingPdf(true);
        try {
            await generateEmployeePayrollPDF({
                employee,
                summary,
                consumptions,
                settlements,
                bcvRate: bcvRate || effectiveRate
            });
            showToast(`Reporte PDF de ${employee.nombre} generado con éxito`, 'success');
            triggerHaptic?.();
        } catch (err) {
            console.error('Error generando PDF:', err);
            showToast('Error al generar el reporte PDF', 'error');
        } finally {
            setExportingPdf(false);
        }
    };

    const handleVoidSettlement = settlement => {
        if (!isAdmin) {
            showToast('Solo el Administrador puede anular liquidaciones de nómina', 'error');
            return;
        }
        if (!settlement?.id || settlement.status !== 'PAID') return;
        setConfirmModal({
            isOpen: true,
            title: '¿Anular Liquidación de Nómina?',
            message: `Se anulará la liquidación de $${Number(settlement.netoAPagarUsd || 0).toFixed(2)} pagada a ${historyEmployee?.nombre || 'este empleado'}.\n\nEl período quedará nuevamente abierto para realizar una nueva liquidación si es necesario.`,
            confirmText: 'Sí, Anular Liquidación',
            variant: 'danger',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                try {
                    await voidEmployeePayrollSettlement(settlement.id, 'Corrección autorizada por ADMIN');
                    showToast('Liquidación anulada y reversada', 'success');
                    const [items, summary, settlements] = await Promise.all([
                        getEmployeeHistory(historyEmployee?.id),
                        getEmployeePayrollSummary(historyEmployee?.id),
                        getPayrollSettlements({ employeeId: historyEmployee?.id, periodoId: settlement.periodoId }),
                    ]);
                    setHistory(items);
                    setHistorySummary(summary);
                    setSettlementHistory(settlements);
                    await loadEmployees(true);
                    window.dispatchEvent(new CustomEvent('employee-data-updated'));
                } catch (error) {
                    showToast(error?.message || 'No se pudo anular la liquidación', 'error');
                }
            }
        });
    };

    const handleVoidConsumption = consumption => {
        if (!isAdmin) {
            showToast('Solo el Administrador puede anular consumos de empleados', 'error');
            return;
        }
        if (!consumption?.id || consumption.settlementId) return;
        const totalItems = consumption.items?.length || 1;
        setConfirmModal({
            isOpen: true,
            title: '¿Anular Consumo de Personal?',
            message: `¿Deseas anular este consumo de $${Number(consumption.totalUsd || 0).toFixed(2)} (${totalItems} producto${totalItems > 1 ? 's' : ''}) de ${historyEmployee?.nombre || 'este empleado'}?\n\nLas unidades serán devueltas automáticamente al inventario físico de la tienda.`,
            confirmText: 'Sí, Anular Consumo',
            variant: 'danger',
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                try {
                    await voidEmployeeConsumption(consumption.id, 'Corrección autorizada por ADMIN');
                    showToast('Consumo anulado e inventario devuelto', 'success');
                    const [items, summary] = await Promise.all([
                        getEmployeeHistory(historyEmployee?.id),
                        getEmployeePayrollSummary(historyEmployee?.id),
                    ]);
                    const settlements = await getPayrollSettlements({
                        employeeId: historyEmployee?.id,
                        periodoId: summary.periodoId,
                    });
                    setHistory(items);
                    setHistorySummary(summary);
                    setSettlementHistory(settlements);
                    await loadEmployees(true);
                    window.dispatchEvent(new CustomEvent('employee-data-updated'));
                } catch (error) {
                    showToast(error?.message || 'No se pudo anular el consumo', 'error');
                }
            }
        });
    };

    const printPayrollReceipt = settlement => {
        if (!settlement) return;
        const receipt = {
            id: settlement.id,
            saleNumber: `NOM-${String(settlement.id).slice(-8)}`,
            timestamp: settlement.paidAt || new Date().toISOString(),
            customerName: `Empleado: ${settlement.employeeNombre}`,
            totalUsd: settlement.netoAPagarUsd,
            totalBs: settlement.netoAPagarBs,
            rate: settlement.tasaBcv,
            items: [{ name: 'Pago de nómina semanal', qty: 1, priceUsd: settlement.netoAPagarUsd }],
            payments: (settlement.payments || []).map(payment => ({
                ...payment,
                amountUsd: Math.abs(Number(payment.amountUsd || 0)),
                amountBs: Math.abs(Number(payment.amountBs || 0)),
                amountCop: Math.abs(Number(payment.amountCop || 0)),
            })),
        };
        printThermalTicket(receipt, settlement.tasaBcv);
        showToast('Recibo de nómina enviado a impresión', 'success');
    };

    const openSettlement = async (employee, e) => {
        e?.stopPropagation?.();
        try {
            const [summary, methods] = await Promise.all([
                getEmployeePayrollSummary(employee.id),
                getActivePaymentMethods(),
            ]);
            if (summary.settled) {
                showToast('La nómina de este período ya fue liquidada', 'info');
                return;
            }
            const supportedMethods = methods.filter(method => ['USD', 'BS'].includes(
                String(method.currency || '').toUpperCase(),
            ));
            if (supportedMethods.length === 0) {
                throw new Error('Configura al menos un método de pago activo en USD o Bs');
            }
            const initialMethod = supportedMethods.find(method => method.id === 'efectivo_usd')
                || supportedMethods[0];
            const initialCurrency = String(initialMethod.currency || 'USD').toUpperCase();
            setSettlementMethods(supportedMethods);
            setSettlementEmployee(employee);
            setSettlementSummary(summary);
            setSettlementMethod(initialMethod.id);
            setSettlementCurrency(initialCurrency);
            setSettlementNote('');
        } catch (error) {
            showToast(error?.message || 'No se pudo cargar el balance', 'error');
        }
    };

    const submitSettlement = async () => {
        if (!settlementEmployee || !settlementSummary || saving) return;
        setSaving(true);
        try {
            const result = await settleEmployeePayroll({
                employeeId: settlementEmployee.id,
                periodoId: settlementSummary.periodoId,
                pagos: [{
                    metodoId: settlementMethod,
                    monto: settlementCurrency === 'BS'
                        ? Number(settlementSummary.netoAPagarBs || 0)
                        : Number(settlementSummary.netoAPagarUsd || 0),
                    moneda: settlementCurrency,
                }],
                nota: settlementNote,
            });
            showToast('Nómina liquidada exitosamente', 'success');
            triggerHaptic?.();
            setSettlementEmployee(null);
            setSettlementSummary(null);
            setReceiptSettlement(result.settlement);
            await loadEmployees();
            window.dispatchEvent(new CustomEvent('employee-data-updated'));
        } catch (error) {
            showToast(error?.message || 'No se pudo liquidar la nómina', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!isAdmin) {
        return (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-6 text-center text-amber-800 dark:text-amber-300">
                <BriefcaseBusiness className="mx-auto mb-2 opacity-60" size={32} />
                <p className="font-bold text-sm">Acceso restringido</p>
                <p className="text-xs opacity-80 mt-1">Solo los administradores pueden gestionar empleados, configurar salarios y liquidar nómina.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-brand-light dark:bg-brand/10 text-brand flex items-center justify-center">
                        <Users size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-black text-slate-800 dark:text-white">Empleados y Nómina</h2>
                        <p className="text-xs text-slate-400">{activeEmployees.length} empleado(s) activo(s) · Toca una ficha para ver detalle</p>
                    </div>
                </div>
                <button type="button" onClick={startCreate} className="min-h-11 px-4 rounded-xl bg-brand text-white text-xs font-black flex items-center justify-center gap-2 active:scale-95 shadow-sm">
                    <Plus size={16} /> Nuevo empleado
                </button>
            </div>

            {showForm && (
                <form onSubmit={submitEmployee} className="rounded-2xl border border-brand/20 bg-brand-light/30 dark:bg-brand/5 p-4 sm:p-5 space-y-4 shadow-sm animate-fade-in">
                    <div className="flex items-center justify-between border-b border-brand/10 dark:border-brand/10 pb-3">
                        <div>
                            <h3 className="font-black text-slate-800 dark:text-white text-base">{editingId ? 'Editar empleado' : 'Nuevo empleado'}</h3>
                            <p className="text-xs text-slate-400">Configura el personal para control de consumos y pago de nómina.</p>
                        </div>
                        <button type="button" onClick={() => setShowForm(false)} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white/60 dark:hover:bg-slate-800 transition-colors"><X size={18} /></button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        {/* Selector de Usuario Asociado */}
                        <div className="col-span-1 sm:col-span-2">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                                Asociar con usuario del sistema (Opcional)
                            </label>
                            <UserSelectDropdown
                                value={form.userId}
                                onChange={handleUserChange}
                                usuarios={usuarios}
                            />
                            <p className="text-[10px] text-slate-400 mt-1.5">
                                Si seleccionas un usuario, se autocompletará su nombre y cargo sugerido.
                            </p>
                        </div>

                        {/* Nombre del Empleado */}
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                            Nombre del empleado *
                            <input
                                required
                                value={form.nombre}
                                onChange={event => setForm({ ...form, nombre: event.target.value })}
                                className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                                placeholder="Ej. Juan Pérez"
                            />
                        </label>

                        {/* Cargo / Puesto */}
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                            Cargo / Puesto
                            <input
                                value={form.cargo}
                                onChange={event => setForm({ ...form, cargo: event.target.value })}
                                className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                                placeholder="Ej. Cajero / Pasillero / Encargado"
                            />
                        </label>

                        {/* Salario Semanal USD */}
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                            Salario semanal USD ($) *
                            <input
                                required
                                type="number"
                                min="0"
                                step="0.01"
                                value={form.salarioSemanalUsd}
                                onChange={event => setForm({ ...form, salarioSemanalUsd: event.target.value })}
                                className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                                placeholder="0.00"
                            />
                        </label>

                        {/* Límite de Consumo Semanal */}
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                            Límite de consumo semanal (%) *
                            <div className="relative mt-1">
                                <input
                                    required
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={form.limiteConsumoPorc}
                                    onChange={event => setForm({ ...form, limiteConsumoPorc: event.target.value })}
                                    className="w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 pr-8 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                                    placeholder="100"
                                />
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                            </div>
                            {Number(form.salarioSemanalUsd) > 0 && (
                                <p className="text-[10px] text-slate-400 mt-1 font-medium">
                                    Equivale a máx. <span className="font-bold text-brand">{formatUsd((Number(form.salarioSemanalUsd) * Number(form.limiteConsumoPorc || 100)) / 100)}</span> en consumos
                                </p>
                            )}
                        </label>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-brand/10 dark:border-brand/10">
                        <button type="button" onClick={() => setShowForm(false)} className="min-h-10 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 text-xs font-bold transition-colors cursor-pointer">
                            Cancelar
                        </button>
                        <button type="submit" disabled={saving} className="min-h-10 px-5 rounded-xl bg-brand text-white text-xs font-black flex items-center gap-2 hover:bg-brand-dark transition-colors disabled:opacity-50 cursor-pointer shadow-sm">
                            <Check size={15} /> {saving ? 'Guardando...' : (editingId ? 'Actualizar empleado' : 'Guardar empleado')}
                        </button>
                    </div>
                </form>
            )}

            <div className="space-y-3">
                {loading && <p className="py-8 text-center text-xs font-bold text-slate-400">Cargando empleados...</p>}
                {!loading && employees.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-8 text-center">
                        <p className="text-sm font-bold text-slate-500">Aún no hay empleados registrados</p>
                        <p className="text-xs text-slate-400 mt-1">Registra al personal para gestionar sus consumos semanales y liquidaciones.</p>
                    </div>
                )}
                {employees.map(employee => {
                    const sum = summaries[employee.id];
                    const salario = Number(employee.salarioSemanalUsd || 0);
                    const consumos = Number(sum?.totalConsumosUsd || 0);
                    const neto = Number(sum?.netoAPagarUsd ?? (salario - consumos));
                    const isSettled = Boolean(sum?.settled);

                    return (
                        <div
                            key={employee.id}
                            onClick={() => openHistory(employee)}
                            className={`rounded-2xl border p-4 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md hover:border-brand/30 active:scale-[0.99] ${employee.activo ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800' : 'bg-slate-50 dark:bg-slate-950 border-slate-200/60 opacity-70'}`}
                        >
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                {/* Datos del Empleado */}
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-11 h-11 rounded-2xl bg-brand/10 text-brand flex items-center justify-center font-black text-base shrink-0">
                                        {employee.nombre.slice(0, 1).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-black text-sm text-slate-800 dark:text-white truncate">{employee.nombre}</p>
                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${employee.activo ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'}`}>
                                                {employee.activo ? 'Activo' : 'Inactivo'}
                                            </span>
                                            {isSettled && (
                                                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400">
                                                    Liquidado
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-slate-400 mt-0.5">
                                            {employee.cargo || 'Personal'}
                                            {employee.usuarioNombre ? ` · 👤 Usuario: ${employee.usuarioNombre}` : ''}
                                        </p>
                                    </div>
                                </div>

                                {/* Métricas Financieras: Salario, Consumo, Saldo Restante */}
                                <div className="flex flex-wrap items-center gap-3 sm:gap-5 bg-slate-50 dark:bg-slate-800/40 p-2.5 sm:px-4 rounded-xl border border-slate-100 dark:border-slate-800/80 shrink-0">
                                    <div className="text-left sm:text-right min-w-[60px]">
                                        <span className="text-[10px] uppercase font-bold text-slate-400 block">Salario</span>
                                        <span className="text-xs font-black text-slate-700 dark:text-slate-200">{formatUsd(salario)}</span>
                                    </div>

                                    <div className="text-left sm:text-right min-w-[70px]">
                                        <span className={`text-[10px] uppercase font-bold block ${consumos > 0 ? 'text-amber-500' : 'text-slate-400'}`}>Consumido</span>
                                        <span className={`text-xs font-black ${consumos > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 font-semibold'}`}>
                                            {consumos > 0 ? `-${formatUsd(consumos)}` : '$0.00'}
                                        </span>
                                    </div>

                                    <div className="text-left sm:text-right min-w-[75px] pl-2.5 border-l border-slate-200 dark:border-slate-700">
                                        <span className="text-[10px] uppercase font-black text-emerald-600 dark:text-emerald-400 block">Saldo Restante</span>
                                        <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{formatUsd(neto)}</span>
                                    </div>
                                </div>

                                {/* Botones de Acción */}
                                <div className="flex items-center gap-1.5 shrink-0 self-end md:self-center" onClick={e => e.stopPropagation()}>
                                    <button
                                        type="button"
                                        onClick={e => { e.stopPropagation(); openHistory(employee); }}
                                        className="p-2 rounded-xl text-slate-500 hover:text-brand hover:bg-brand/10 transition-colors"
                                        title="Ver historial y descargar PDF"
                                    >
                                        <History size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={e => startEdit(employee, e)}
                                        className="p-2 rounded-xl text-slate-500 hover:text-brand hover:bg-brand/10 transition-colors"
                                        title="Editar empleado"
                                    >
                                        <Pencil size={16} />
                                    </button>
                                    {employee.activo && !isSettled && (
                                        <button
                                            type="button"
                                            onClick={e => openSettlement(employee, e)}
                                            className="px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-black transition-colors active:scale-95 shadow-sm"
                                        >
                                            Liquidar
                                        </button>
                                    )}
                                    {employee.activo && (
                                        <button
                                            type="button"
                                            onClick={e => handleDeactivate(employee, e)}
                                            className="p-2 rounded-xl text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
                                            title="Desactivar empleado"
                                        >
                                            <UserMinus size={16} />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={e => handleDeleteEmployee(employee, e)}
                                        className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                        title="Eliminar empleado definitivamente"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Modal de Historial y Detalle de Consumos con Descarga PDF */}
            {historyEmployee && (
                <div className="fixed inset-0 z-[210] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setHistoryEmployee(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-hidden shadow-2xl flex flex-col" onClick={event => event.stopPropagation()}>
                        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
                            <div>
                                <h3 className="font-black text-base text-slate-800 dark:text-white">Historial de {historyEmployee.nombre}</h3>
                                <p className="text-xs text-slate-400">Período {historySummary?.periodoId || 'actual'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleDownloadPDF(historyEmployee, historySummary, history, settlementHistory)}
                                    disabled={exportingPdf}
                                    className="px-3.5 py-2 rounded-xl bg-brand text-white text-xs font-black flex items-center gap-1.5 active:scale-95 shadow-sm hover:bg-brand/90 transition-all disabled:opacity-50"
                                    title="Descargar reporte en PDF"
                                >
                                    <FileText size={15} />
                                    <span>{exportingPdf ? 'Generando...' : 'Descargar PDF'}</span>
                                </button>
                                <button onClick={() => setHistoryEmployee(null)} className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"><X size={17} /></button>
                            </div>
                        </div>

                        <div className="p-5 overflow-y-auto max-h-[70vh] space-y-3">
                            {historySummary && (
                                <div className="grid grid-cols-3 gap-2 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-100 dark:border-slate-800">
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-slate-400">Salario</p>
                                        <strong className="text-sm font-black text-slate-800 dark:text-white">{formatUsd(historySummary.salarioSemanalUsd)}</strong>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-amber-500">Consumos</p>
                                        <strong className="text-sm font-black text-amber-600">{formatUsd(historySummary.totalConsumosUsd)}</strong>
                                    </div>
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-emerald-500">Saldo Restante</p>
                                        <strong className="text-sm font-black text-emerald-600">{formatUsd(historySummary.netoAPagarUsd)}</strong>
                                    </div>
                                </div>
                            )}

                            {settlementHistory.map(item => (
                                <div key={item.id} className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-3">
                                    <div className="flex items-center justify-between gap-2 text-xs">
                                        <strong className="text-emerald-800 dark:text-emerald-300">Liquidación {item.status === 'PAID' ? 'PAGADA' : (item.status === 'VOIDED' ? 'ANULADA' : item.status)}</strong>
                                        <strong className="text-emerald-700 dark:text-emerald-300">{formatUsd(item.netoAPagarUsd)}</strong>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 mt-1">
                                        <p className="text-[10px] text-slate-500">{item.paidAt ? new Date(item.paidAt).toLocaleString('es-VE') : 'Sin fecha de pago'}</p>
                                        {isAdmin && item.status === 'PAID' && (
                                            <button type="button" onClick={() => handleVoidSettlement(item)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black text-rose-600 bg-rose-50 hover:bg-rose-100" title="Anular liquidación">
                                                <RotateCcw size={12} /> Anular pago
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {history.length === 0 && (
                                <div className="py-8 text-center">
                                    <p className="text-xs font-bold text-slate-400">No hay consumos registrados en este período.</p>
                                </div>
                            )}

                            {history.map(item => (
                                <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
                                    <div className="flex justify-between gap-2 text-xs">
                                        <strong className="text-slate-800 dark:text-white">{new Date(item.timestamp).toLocaleString('es-VE')}</strong>
                                        <strong className="text-slate-800 dark:text-white">{formatUsd(item.totalUsd)}</strong>
                                    </div>
                                    <p className="text-[11px] text-slate-500 mt-1">{item.items?.map(line => `${line.qty} × ${line.name}`).join(', ')}</p>
                                    <div className="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${item.status === 'VOIDED' ? 'bg-rose-50 text-rose-600' : (item.settlementId ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400')}`}>
                                            {item.status === 'VOIDED' ? 'ANULADO' : (item.settlementId ? 'LIQUIDADO' : 'CONSUMIDO')}
                                        </span>
                                        {isAdmin && item.status === 'APPLIED' && !item.settlementId && (
                                            <button type="button" onClick={() => handleVoidConsumption(item)} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black text-rose-600 bg-rose-50 hover:bg-rose-100" title="Anular y devolver inventario">
                                                <RotateCcw size={12} /> Anular
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Recibo de Liquidación Térmico */}
            {receiptSettlement && (
                <div className="fixed inset-0 z-[220] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setReceiptSettlement(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl p-5 space-y-4" onClick={event => event.stopPropagation()}>
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="font-black text-slate-800 dark:text-white">Nómina liquidada</h3>
                                <p className="text-xs text-slate-400">{receiptSettlement.employeeNombre} · {formatUsd(receiptSettlement.netoAPagarUsd)}</p>
                            </div>
                            <button type="button" onClick={() => setReceiptSettlement(null)} className="p-2 text-slate-400"><X size={17} /></button>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400">El pago quedó registrado. Puedes imprimir el recibo térmico o descargar el reporte PDF.</p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setReceiptSettlement(null)} className="flex-1 min-h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold">Cerrar</button>
                            <button type="button" onClick={() => printPayrollReceipt(receiptSettlement)} className="flex-1 min-h-11 rounded-xl bg-brand text-white text-xs font-black inline-flex items-center justify-center gap-1.5"><Printer size={15} /> Imprimir</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Confirmación de Liquidación */}
            {settlementEmployee && settlementSummary && (
                <div className="fixed inset-0 z-[210] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setSettlementEmployee(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl p-5 space-y-4" onClick={event => event.stopPropagation()}>
                        <div className="flex items-start justify-between">
                            <div>
                                <h3 className="font-black text-slate-800 dark:text-white">Liquidar nómina</h3>
                                <p className="text-xs text-slate-400">{settlementEmployee.nombre} · {settlementSummary.periodoId}</p>
                            </div>
                            <button onClick={() => setSettlementEmployee(null)} className="p-2 text-slate-400"><X size={17} /></button>
                        </div>
                        <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 p-4 text-center">
                            <p className="text-xs text-slate-400">Neto a pagar</p>
                            <p className="text-3xl font-black text-emerald-600">{formatUsd(settlementSummary.netoAPagarUsd)}</p>
                            <p className="text-xs font-bold text-slate-500 mt-1">Consumos deducidos: {formatUsd(settlementSummary.totalConsumosUsd)}</p>
                        </div>
                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Método de pago
                            <select
                                value={settlementMethod}
                                onChange={event => {
                                    const method = settlementMethods.find(item => item.id === event.target.value);
                                    setSettlementMethod(event.target.value);
                                    setSettlementCurrency(String(method?.currency || 'USD').toUpperCase());
                                }}
                                className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 outline-none"
                            >
                                {settlementMethods.map(method => (
                                    <option key={method.id} value={method.id}>
                                        {method.label || method.id} · {String(method.currency || '').toUpperCase()}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-300">
                            Moneda: {settlementCurrency} · Monto: {settlementCurrency === 'BS' ? `${Number(settlementSummary.netoAPagarBs || 0).toLocaleString('es-VE')} Bs` : formatUsd(settlementSummary.netoAPagarUsd)}
                        </div>
                        <textarea
                            value={settlementNote}
                            onChange={event => setSettlementNote(event.target.value)}
                            placeholder="Nota u observación opcional..."
                            rows={2}
                            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs resize-none outline-none"
                        />
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setSettlementEmployee(null)} className="flex-1 min-h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold">Cancelar</button>
                            <button type="button" onClick={submitSettlement} disabled={saving} className="flex-1 min-h-11 rounded-xl bg-emerald-500 text-white text-xs font-black disabled:opacity-50 active:scale-95 shadow-sm">
                                {saving ? 'Procesando...' : 'Confirmar pago'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación Premium */}
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                confirmText={confirmModal.confirmText}
                variant={confirmModal.variant || 'danger'}
            />
        </div>
    );
}
