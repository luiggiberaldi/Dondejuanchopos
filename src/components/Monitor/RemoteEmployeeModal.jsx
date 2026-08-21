import React, { useState, useEffect } from 'react';
import { X, Check, Users, Shield, Briefcase, DollarSign, Percent, Loader2 } from 'lucide-react';
import UserSelectDropdown from '../Employees/UserSelectDropdown';
import { showToast } from '../Toast';

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

export default function RemoteEmployeeModal({
    isOpen,
    onClose,
    onSubmit,
    usuarios = [],
    editingEmployee = null
}) {
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (editingEmployee) {
                setForm({
                    nombre: editingEmployee.nombre || editingEmployee.employeeNombre || '',
                    cargo: editingEmployee.cargo || '',
                    userId: editingEmployee.userId !== undefined && editingEmployee.userId !== null ? String(editingEmployee.userId) : '',
                    usuarioNombre: editingEmployee.usuarioNombre || '',
                    salarioSemanalUsd: String(editingEmployee.salarioSemanalUsd ?? ''),
                    limiteConsumoPorc: String(editingEmployee.limiteConsumoPorc ?? 100),
                });
            } else {
                setForm(EMPTY_FORM);
            }
        }
    }, [isOpen, editingEmployee]);

    if (!isOpen) return null;

    const handleUserChange = (selectedUser) => {
        if (!selectedUser) {
            setForm(prev => ({ ...prev, userId: '', usuarioNombre: '' }));
            return;
        }
        setForm(prev => ({
            ...prev,
            userId: selectedUser.id,
            usuarioNombre: selectedUser.nombre,
            nombre: prev.nombre.trim() === '' ? selectedUser.nombre : prev.nombre,
            cargo: prev.cargo.trim() === '' ? (selectedUser.rol === 'ADMIN' ? 'Administrador' : 'Cajero') : prev.cargo,
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (saving) return;

        const nombreTrim = form.nombre.trim();
        if (!nombreTrim || nombreTrim.length < 2) {
            showToast('El nombre del empleado es obligatorio (mínimo 2 caracteres)', 'error');
            return;
        }

        const salario = Number(form.salarioSemanalUsd);
        if (!Number.isFinite(salario) || salario < 0) {
            showToast('Ingresa un salario semanal válido', 'error');
            return;
        }

        const limite = Number(form.limiteConsumoPorc);
        if (!Number.isFinite(limite) || limite < 0 || limite > 100) {
            showToast('El límite de consumo debe ser entre 0% y 100%', 'error');
            return;
        }

        setSaving(true);
        try {
            const employeeData = {
                id: editingEmployee?.id || editingEmployee?.employeeId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `emp_${Date.now()}`),
                nombre: nombreTrim,
                cargo: form.cargo.trim() || 'Personal',
                userId: form.userId ? form.userId : null,
                usuarioNombre: form.usuarioNombre || null,
                salarioSemanalUsd: salario,
                limiteConsumoPorc: limite,
                activo: editingEmployee?.activo !== undefined ? editingEmployee.activo : true,
                createdAt: editingEmployee?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            const submitted = await onSubmit(employeeData);
            if (submitted !== false) onClose();
        } catch (err) {
            showToast(err?.message || 'Error al guardar empleado', 'error');
        } finally {
            setSaving(false);
        }
    };

    const salarioNum = Number(form.salarioSemanalUsd) || 0;
    const limiteNum = Number(form.limiteConsumoPorc) || 100;
    const maxConsumoUsd = (salarioNum * limiteNum) / 100;

    return (
        <div className="fixed inset-0 z-[220] bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
            <div 
                className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg max-h-[92vh] shadow-2xl border border-slate-200/80 dark:border-slate-800 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header Fijo */}
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-brand/10 text-brand flex items-center justify-center font-black shrink-0">
                            <Users size={20} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-black text-slate-800 dark:text-white text-sm sm:text-base truncate">
                                {editingEmployee ? 'Editar Empleado (Supervisor)' : 'Nuevo Empleado (Supervisor)'}
                            </h3>
                            <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                                Gestiona el personal y envía el comando en tiempo real a la caja.
                            </p>
                        </div>
                    </div>
                    <button 
                        type="button" 
                        onClick={onClose}
                        className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Formulario con Scroll Interno Suave */}
                <form id="remote-employee-form" onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 custom-scrollbar">
                    {/* Selector de Usuario Asociado */}
                    <div>
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        {/* Nombre del Empleado */}
                        <div className="col-span-1 sm:col-span-2">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                                Nombre del empleado *
                            </label>
                            <input
                                required
                                value={form.nombre}
                                onChange={e => setForm({ ...form, nombre: e.target.value })}
                                className="w-full min-h-[46px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all shadow-xs"
                                placeholder="Ej. Juan Pérez"
                            />
                        </div>

                        {/* Cargo / Puesto */}
                        <div className="col-span-1 sm:col-span-2">
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                                Cargo / Puesto
                            </label>
                            <input
                                value={form.cargo}
                                onChange={e => setForm({ ...form, cargo: e.target.value })}
                                className="w-full min-h-[46px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all shadow-xs"
                                placeholder="Ej. Cajero / Pasillero / Encargado"
                            />
                        </div>

                        {/* Salario Semanal USD */}
                        <div>
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                                Salario semanal USD ($) *
                            </label>
                            <div className="relative">
                                <input
                                    required
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={form.salarioSemanalUsd}
                                    onChange={e => setForm({ ...form, salarioSemanalUsd: e.target.value })}
                                    className="w-full min-h-[46px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 pl-8 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all shadow-xs"
                                    placeholder="0.00"
                                />
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">$</span>
                            </div>
                        </div>

                        {/* Límite de Consumo Semanal */}
                        <div>
                            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                                Límite de consumo (%) *
                            </label>
                            <div className="relative">
                                <input
                                    required
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="1"
                                    value={form.limiteConsumoPorc}
                                    onChange={e => setForm({ ...form, limiteConsumoPorc: e.target.value })}
                                    className="w-full min-h-[46px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 pr-8 text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-brand/30 transition-all shadow-xs"
                                    placeholder="100"
                                />
                                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
                            </div>
                        </div>
                    </div>

                    {salarioNum > 0 && (
                        <div className="p-3 rounded-2xl bg-brand/5 dark:bg-brand/10 border border-brand/20 flex items-center justify-between">
                            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">
                                Consumo máximo permitido:
                            </span>
                            <span className="text-xs font-black text-brand">
                                {formatUsd(maxConsumoUsd)} / semana
                            </span>
                        </div>
                    )}
                </form>

                {/* Footer Fijo con Botones de Acción */}
                <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 flex justify-end gap-2.5 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="min-h-11 px-4 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold transition-all cursor-pointer"
                    >
                        Cancelar
                    </button>
                    <button
                        type="submit"
                        form="remote-employee-form"
                        disabled={saving}
                        className="min-h-11 px-5 rounded-2xl bg-brand text-white text-xs font-black flex items-center gap-2 hover:bg-brand-dark transition-all disabled:opacity-50 cursor-pointer shadow-md shadow-brand/20 active:scale-95"
                    >
                        {saving ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Enviando a caja...</span>
                            </>
                        ) : (
                            <>
                                <Check size={16} />
                                <span>{editingEmployee ? 'Actualizar empleado' : 'Guardar y Enviar a Caja'}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
