import { describe, expect, it, vi } from 'vitest';
import { queueSupervisorCustomerMovementVoid } from '../src/utils/supervisorCustomerMovementVoid';

const sale = {
    id: 'movement-1',
    tipo: 'COBRO_DEUDA',
    status: 'COMPLETADA',
    customerId: 'customer-1',
    customerTransactionId: 'transaction-1',
    totalUsd: 4,
};
const identities = { supabase: {}, primaryDeviceId: 'box-1', monitorDeviceId: 'monitor-1', customerId: 'customer-1', sale,
    actor: { id: 'user-1', nombre: 'Supervisor', rol: 'SUPERVISOR' }, reason: 'Se digitó un monto incorrecto', commandId: 'void-command-1' };

function makeSupabase({ insertResult = { error: null }, storedRow = null } = {}) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: storedRow, error: null });
    const query = {
        insert: vi.fn().mockResolvedValue(insertResult),
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle,
    };
    return { client: { from: vi.fn(() => query) }, query, maybeSingle };
}

describe('Supervisor customer movement void command', () => {
    it('requires a reason, paired identity, supported transaction and exact customer', async () => {
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, reason: '  ' })).rejects.toThrow(/motivo/);
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, monitorDeviceId: null })).rejects.toThrow(/identidad/);
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, customerId: 'different-customer' })).rejects.toThrow(/verificar/);
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, sale: { ...sale, tipo: 'VENTA' } })).rejects.toThrow(/créditos o abonos/);
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, sale: { ...sale, status: 'ANULADA' } })).rejects.toThrow(/ya fue anulado/);
    });

    it('sends an audited void_sale command for the original movement and customer', async () => {
        const supabase = makeSupabase();
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, supabase: supabase.client }))
            .resolves.toMatchObject({ commandId: 'void-command-1', saleId: 'movement-1', status: 'pending' });
        expect(supabase.client.from).toHaveBeenCalledWith('supervisor_commands');
        expect(supabase.query.insert).toHaveBeenCalledWith(expect.objectContaining({
            id: 'void-command-1',
            primary_device_id: 'box-1',
            monitor_device_id: 'monitor-1',
            command_type: 'void_sale',
            status: 'pending',
            payload: expect.objectContaining({
                saleId: 'movement-1', customerMovementVoid: true, customerId: 'customer-1',
                customerTransactionId: 'transaction-1', reason: 'Se digitó un monto incorrecto',
                supervisorId: 'user-1',
            }),
        }));
    });

    it('allows a missing actor and records safe supervisor defaults', async () => {
        const supabase = makeSupabase();
        await expect(queueSupervisorCustomerMovementVoid({
            ...identities,
            actor: null,
            supabase: supabase.client,
        })).resolves.toMatchObject({ status: 'pending' });
        expect(supabase.query.insert).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                supervisorId: null,
                supervisorName: 'Supervisor',
                supervisorRole: 'SUPERVISOR',
            }),
        }));
    });

    it('resolves a lost insert response only when the stored request is identical', async () => {
        const request = {
            id: 'void-command-1',
            primary_device_id: 'box-1',
            monitor_device_id: 'monitor-1',
            command_type: 'void_sale',
            status: 'pending',
            payload: {
                commandId: 'void-command-1', saleId: 'movement-1', customerMovementVoid: true,
                customerId: 'customer-1', customerTransactionId: 'transaction-1',
                reason: 'Se digitó un monto incorrecto', supervisorId: 'user-1',
                supervisorName: 'Supervisor', supervisorRole: 'SUPERVISOR',
            },
        };
        const supabase = makeSupabase({
            insertResult: { error: { message: 'duplicate request', code: '23505' } },
            storedRow: { ...request, status: 'pending' },
        });
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, supabase: supabase.client }))
            .resolves.toMatchObject({ commandId: 'void-command-1', status: 'pending' });
        expect(supabase.maybeSingle).toHaveBeenCalledOnce();

        const conflict = makeSupabase({
            insertResult: { error: { message: 'duplicate request', code: '23505' } },
            storedRow: { ...request, payload: { ...request.payload, reason: 'otro motivo' } },
        });
        await expect(queueSupervisorCustomerMovementVoid({ ...identities, supabase: conflict.client }))
            .rejects.toThrow(/otro contenido/);
    });
});
