import { useState, useCallback } from 'react';
import { showToast } from '../components/Toast';
import { fetchRemoteEmployeePayrollDetail } from '../services/remoteAuditService';
import { createSupervisorCommandId } from '../utils/supervisorCommandModel';

/**
 * Lógica de Nómina y Consumos del Monitor de Supervisión:
 * proyección sincronizada, detalle remoto bajo demanda, anulación de
 * consumos y alta/edición/borrado de empleados vía comandos supervisor.
 */
export function useMonitorPayroll({
    pairedDeviceId,
    supabaseCloud,
    supervisorUser,
    triggerHaptic,
    setShowCreateEmployeeModal,
    setEditingEmployee,
    editingEmployee,
}) {
    const [payrollProjection, setPayrollProjection] = useState(null);
    const [payrollDetail, setPayrollDetail] = useState(null);
    const [payrollDetailLoading, setPayrollDetailLoading] = useState(false);
    const [payrollDetailError, setPayrollDetailError] = useState(null);
    const [confirmVoidConsumptionTarget, setConfirmVoidConsumptionTarget] = useState(null);
    const [voidingConsumption, setVoidingConsumption] = useState(false);
    const [deleteEmployeeTarget, setDeleteEmployeeTarget] = useState(null);

    const handlePayrollDetail = useCallback(async (employee) => {
        const periodId = payrollProjection?.periodo?.id || payrollProjection?.periodo?.periodoId || 'actual';
        if (!employee) return;
        setPayrollDetailLoading(true);
        setPayrollDetailError(null);
        setPayrollDetail(null);
        const detailData = {
            employeeId: employee.employeeId,
            employee,
            periodoId: periodId,
            consumptions: [],
            settlements: []
        };
        try {
            if (pairedDeviceId && periodId && periodId !== 'actual') {
                const result = await fetchRemoteEmployeePayrollDetail(
                    pairedDeviceId,
                    employee.employeeId,
                    periodId,
                    supabaseCloud,
                );
                if (result.success) {
                    detailData.consumptions = Array.isArray(result.consumptions) ? result.consumptions : [];
                    detailData.settlements = Array.isArray(result.settlements) ? result.settlements : [];
                }
            }
            setPayrollDetail(detailData);
        } catch (err) {
            console.warn('[OwnerMonitorView] Detalle remoto no disponible, usando proyección local:', err);
            setPayrollDetail(detailData);
        } finally {
            setPayrollDetailLoading(false);
        }
    }, [pairedDeviceId, payrollProjection]);

    const handleVoidConsumptionSupervisor = (consumption) => {
        if (!consumption?.id || consumption.settlementId || consumption.status === 'VOIDED') return;
        setConfirmVoidConsumptionTarget(consumption);
    };

    const executeVoidConsumptionSupervisor = async (consumption) => {
        if (!consumption?.id || consumption.settlementId || consumption.status === 'VOIDED' || voidingConsumption) return;
        setVoidingConsumption(true);
        const commandId = createSupervisorCommandId();
        try {
            const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
            if (supabaseCloud && pairedDeviceId) {
                const { error } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert({
                        id: commandId,
                        primary_device_id: pairedDeviceId,
                        monitor_device_id: monitorDeviceId,
                        command_type: 'inventory_update',
                        payload: {
                            action: 'void_employee_consumption',
                            commandId,
                            consumptionId: consumption.id,
                            employeeId: consumption.employeeId,
                            employeeNombre: payrollDetail?.employee?.employeeNombre || consumption.employeeNombre || 'Empleado',
                            totalUsd: consumption.totalUsd || 0,
                            totalBs: consumption.totalBs || 0,
                            reason: 'Anulado por Supervisor desde Monitor',
                            supervisorId: supervisorUser?.id || null,
                            supervisorName: supervisorUser?.nombre || supervisorUser?.usuario || 'Supervisor',
                            supervisorRole: supervisorUser?.rol || 'SUPERVISOR',
                        },
                        status: 'pending'
                    });

                if (error) throw error;
                showToast('Comando de anulación enviado a la caja principal', 'success');
                setPayrollDetail(prev => {
                    if (!prev) return prev;
                    const nextConsumptions = (prev.consumptions || []).map(c => c.id === consumption.id ? { ...c, status: 'VOIDED' } : c);
                    const activeCons = nextConsumptions.filter(c => c.status !== 'VOIDED');
                    const newTotalConsumos = activeCons.reduce((sum, c) => sum + Number(c.totalUsd || 0), 0);
                    const baseSalary = Number(prev.employee?.salarioSemanalUsd || 0);
                    const newNeto = Math.max(0, baseSalary - newTotalConsumos);

                    return {
                        ...prev,
                        consumptions: nextConsumptions,
                        employee: {
                            ...prev.employee,
                            totalConsumosUsd: newTotalConsumos,
                            netoAPagarUsd: newNeto,
                        }
                    };
                });
                setConfirmVoidConsumptionTarget(null);
            } else {
                showToast('Sin conexión con la caja principal', 'error');
            }
        } catch (err) {
            console.error('[OwnerMonitor] Error al solicitar anulación de consumo:', err);
            showToast('No se pudo enviar la anulación de consumo', 'error');
        } finally {
            setVoidingConsumption(false);
        }
    };

    const handleSaveRemoteEmployee = async (employeeData) => {
        const commandId = createSupervisorCommandId();
        const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
        if (supabaseCloud && pairedDeviceId) {
            const { error } = await supabaseCloud
                .from('supervisor_commands')
                .insert({
                    id: commandId,
                    primary_device_id: pairedDeviceId,
                    monitor_device_id: monitorDeviceId,
                    command_type: 'inventory_update',
                    payload: {
                        action: 'save_employee',
                        commandId,
                        employee: employeeData,
                        supervisorId: supervisorUser?.id || null,
                        supervisorName: supervisorUser?.nombre || supervisorUser?.usuario || 'Supervisor',
                        supervisorRole: supervisorUser?.rol || 'SUPERVISOR',
                    },
                    status: 'pending'
                });

            if (error) throw error;
            showToast(editingEmployee ? 'Empleado actualizado y comando enviado a la caja' : 'Empleado creado y comando enviado a la caja', 'success');

            // Actualización optimista de la lista y proyección de nómina
            setPayrollProjection(prev => {
                const currentEmps = Array.isArray(prev?.employees) ? [...prev.employees] : [];
                const idx = currentEmps.findIndex(e => e.employeeId === employeeData.id || e.id === employeeData.id);
                const summaryEntry = {
                    employeeId: employeeData.id,
                    employeeNombre: employeeData.nombre,
                    cargo: employeeData.cargo,
                    salarioSemanalUsd: employeeData.salarioSemanalUsd,
                    limiteConsumoPorc: employeeData.limiteConsumoPorc,
                    totalConsumosUsd: idx >= 0 ? (currentEmps[idx].totalConsumosUsd || 0) : 0,
                    netoAPagarUsd: idx >= 0 ? Math.max(0, employeeData.salarioSemanalUsd - (currentEmps[idx].totalConsumosUsd || 0)) : employeeData.salarioSemanalUsd,
                    porcentajeConsumido: idx >= 0 ? (currentEmps[idx].porcentajeConsumido || 0) : 0,
                    settled: idx >= 0 ? currentEmps[idx].settled : false,
                    settlementId: idx >= 0 ? currentEmps[idx].settlementId : null,
                };
                if (idx >= 0) {
                    currentEmps[idx] = { ...currentEmps[idx], ...summaryEntry };
                } else {
                    currentEmps.push(summaryEntry);
                }
                const totalNomina = currentEmps.reduce((acc, e) => acc + Number(e.salarioSemanalUsd || 0), 0);
                const totalCons = currentEmps.reduce((acc, e) => acc + Number(e.totalConsumosUsd || 0), 0);
                const totalNeto = currentEmps.reduce((acc, e) => acc + Number(e.netoAPagarUsd || 0), 0);
                return {
                    ...(prev || {}),
                    periodo: prev?.periodo || { id: 'actual', status: 'OPEN' },
                    employees: currentEmps,
                    totals: {
                        nominaTotalUsd: totalNomina,
                        consumosTotalUsd: totalCons,
                        netoTotalUsd: totalNeto,
                        employeesCount: currentEmps.length,
                    }
                };
            });
            setShowCreateEmployeeModal(false);
            setEditingEmployee(null);
            return true;
        } else {
            showToast('Sin conexión con la caja principal', 'error');
            return false;
        }
    };

    // Solicitud de borrado: abre la confirmación inline (sin window.confirm, Regla #15)
    const requestDeleteRemoteEmployee = (employee) => {
        if (!employee) return;
        triggerHaptic?.();
        setDeleteEmployeeTarget(employee);
    };

    const executeDeleteRemoteEmployee = async () => {
        const employee = deleteEmployeeTarget;
        if (!employee) return;
        const employeeName = employee.employeeNombre || employee.nombre || 'este empleado';
        const empId = employee.employeeId || employee.id;

        const commandId = createSupervisorCommandId();
        const monitorDeviceId = localStorage.getItem('dj_device_id') || 'monitor_web';
        if (supabaseCloud && pairedDeviceId) {
            try {
                const { error } = await supabaseCloud
                    .from('supervisor_commands')
                    .insert({
                        id: commandId,
                        primary_device_id: pairedDeviceId,
                        monitor_device_id: monitorDeviceId,
                        command_type: 'inventory_update',
                        payload: {
                            action: 'delete_employee',
                            commandId,
                            employeeId: empId,
                            supervisorId: supervisorUser?.id || null,
                            supervisorName: supervisorUser?.nombre || supervisorUser?.usuario || 'Supervisor',
                            supervisorRole: supervisorUser?.rol || 'SUPERVISOR',
                        },
                        status: 'pending'
                    });

                if (error) throw error;
                showToast(`Empleado "${employeeName}" eliminado y comando enviado a la caja`, 'success');
                triggerHaptic?.();

                // Actualización optimista de la proyección
                setPayrollProjection(prev => {
                    const currentEmps = Array.isArray(prev?.employees)
                        ? prev.employees.filter(e => String(e.employeeId || e.id) !== String(empId))
                        : [];
                    const totalNomina = currentEmps.reduce((acc, e) => acc + Number(e.salarioSemanalUsd || 0), 0);
                    const totalCons = currentEmps.reduce((acc, e) => acc + Number(e.totalConsumosUsd || 0), 0);
                    const totalNeto = currentEmps.reduce((acc, e) => acc + Number(e.netoAPagarUsd || 0), 0);
                    return {
                        ...(prev || {}),
                        employees: currentEmps,
                        totals: {
                            nominaTotalUsd: totalNomina,
                            consumosTotalUsd: totalCons,
                            netoTotalUsd: totalNeto,
                            employeesCount: currentEmps.length,
                        }
                    };
                });
                setDeleteEmployeeTarget(null);
            } catch (err) {
                showToast(err?.message || 'No se pudo eliminar el empleado', 'error');
            }
        } else {
            showToast('Sin conexión con la caja principal', 'error');
        }
    };

    const payrollEmployees = Array.isArray(payrollProjection?.employees) ? payrollProjection.employees : [];
    const payrollTotals = payrollProjection?.totals || {
        nominaTotalUsd: 0,
        consumosTotalUsd: 0,
        netoTotalUsd: 0,
        employeesCount: 0,
    };

    return {
        payrollProjection,
        setPayrollProjection,
        payrollDetail,
        setPayrollDetail,
        payrollDetailLoading,
        payrollDetailError,
        confirmVoidConsumptionTarget,
        setConfirmVoidConsumptionTarget,
        voidingConsumption,
        deleteEmployeeTarget,
        setDeleteEmployeeTarget,
        handlePayrollDetail,
        handleVoidConsumptionSupervisor,
        executeVoidConsumptionSupervisor,
        handleSaveRemoteEmployee,
        requestDeleteRemoteEmployee,
        executeDeleteRemoteEmployee,
        payrollEmployees,
        payrollTotals,
    };
}
