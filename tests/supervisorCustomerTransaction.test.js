import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SupervisorCustomerTransactionModal from '../src/components/Monitor/SupervisorCustomerTransactionModal';
import { getActivePaymentMethods } from '../src/config/paymentMethods';

vi.mock('../src/config/paymentMethods', () => ({ getActivePaymentMethods: vi.fn() }));
import { buildSupervisorCustomerTransaction, applySupervisorCustomerTransaction } from '../src/utils/supervisorCustomerTransaction';
import { queueSupervisorCustomerTransaction } from '../src/utils/supervisorCustomerCommandQueue';

const customer = { id: 'customer-1', code: 'CLI-00001', name: 'Ana', deuda: 10, favor: 0 };

function payload(overrides = {}) {
    return buildSupervisorCustomerTransaction({
        customer, type: 'ABONO', amount: '4', currency: 'USD', bcvRate: 40,
        paymentMethod: 'efectivo_usd', commandId: 'command-1', recordId: 'record-1',
        actor: { id: 'monitor-1', nombre: 'Sup', deviceId: 'monitor-1' }, ...overrides,
    });
}

describe('Supervisor customer transactions', () => {
    afterEach(() => vi.restoreAllMocks());

    it('renders payment options in a rounded custom list and closes after selection', async () => {
        getActivePaymentMethods.mockResolvedValue([
            { id: 'efectivo_usd', label: 'Efectivo en Dólares', currency: 'USD', isEnabled: true },
        ]);
        render(React.createElement(SupervisorCustomerTransactionModal, {
            customer, type: 'ABONO', bcvRate: 40, tasaCop: 0, copEnabled: false,
            onClose: vi.fn(), onSubmit: vi.fn(),
        }));
        await waitFor(() => expect(getActivePaymentMethods).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('button', { name: 'Método de pago' }));
        const listbox = screen.getByRole('listbox', { name: 'Métodos de pago' });
        expect(listbox.className).toContain('rounded-2xl');
        fireEvent.click(screen.getByRole('option', { name: 'Efectivo en Dólares' }));
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(screen.getByRole('button', { name: 'Método de pago' }).textContent).toContain('Efectivo en Dólares');
    });

    it('builds an auditable abono and applies it once to the current customer balance', () => {
        const command = payload();
        expect(command.record.tipo).toBe('COBRO_DEUDA');
        expect(command.record.paymentMethod).toBe('efectivo_usd');
        expect(command.record.totalUsd).toBe(4);
        const changed = applySupervisorCustomerTransaction(customer, command);
        expect(changed.deuda).toBe(6);
        expect(changed.favor).toBe(0);
    });

    it('builds a credit movement and supports an abono exceeding the balance', () => {
        const credit = payload({ type: 'CREDITO', amount: 8, paymentMethod: null });
        expect(credit.record.tipo).toBe('VENTA_FIADA');
        expect(applySupervisorCustomerTransaction(customer, credit).deuda).toBe(18);
        const overpayment = payload({ amount: 12 });
        const changed = applySupervisorCustomerTransaction(customer, overpayment);
        expect(changed.deuda).toBe(0);
        expect(changed.favor).toBe(2);
    });

    it('converts Bs and COP with the selected rates and rejects invalid inputs', () => {
        expect(payload({ amount: '400', currency: 'BS' }).amountUsd).toBe(10);
        expect(payload({ amount: '800', currency: 'COP', tasaCop: 80, copEnabled: true }).amountUsd).toBe(10);
        expect(() => payload({ amount: 0 })).toThrow(/mayor que cero/);
        expect(() => payload({ currency: 'COP', copEnabled: false, tasaCop: 80 })).toThrow(/COP/);
        expect(() => payload({ type: 'ABONO', paymentMethod: null })).toThrow(/método/);
        expect(() => payload({ amount: 1001 })).toThrow(/seguridad/);
    });

    it('allows an explicitly approved high amount and keeps the same stable IDs in the envelope', () => {
        const command = payload({ amount: 1001, isExplicitHighAmount: true });
        expect(command.commandId).toBe('command-1');
        expect(command.record.id).toBe('record-1');
        expect(command.record.customerTransactionId).toBe(command.operationId);
    });

    it('reports duplicate delivery only when the stored envelope is identical', async () => {
        const command = payload();
        const row = { id: command.commandId, primary_device_id: 'box-1', monitor_device_id: 'monitor-1', command_type: 'inventory_update', payload: command, status: 'pending' };
        const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
        const supabase = { from: () => ({ insert: async () => ({ error: { code: '23505', message: 'duplicate' } }),
            select() { return this; }, eq() { return this; }, maybeSingle }) };
        await expect(queueSupervisorCustomerTransaction({ supabase, primaryDeviceId: 'box-1', monitorDeviceId: 'monitor-1', payload: command }))
            .resolves.toEqual({ commandId: 'command-1', status: 'pending' });
        expect(maybeSingle).toHaveBeenCalledWith();
    });

    it('rejects a duplicate ID with different stored content and missing pair identity', async () => {
        const command = payload();
        const supabase = { from: () => ({ insert: async () => ({ error: { code: '23505', message: 'duplicate' } }),
            select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: command.commandId, payload: { ...command, amountUsd: 900 } }, error: null }) }) };
        await expect(queueSupervisorCustomerTransaction({ supabase, primaryDeviceId: 'box-1', monitorDeviceId: 'monitor-1', payload: command }))
            .rejects.toThrow(/otro contenido/);
        await expect(queueSupervisorCustomerTransaction({ supabase, primaryDeviceId: null, monitorDeviceId: 'monitor-1', payload: command }))
            .rejects.toThrow(/identidad/);
    });
});
