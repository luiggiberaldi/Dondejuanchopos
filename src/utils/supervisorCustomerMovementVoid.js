import { sameSupervisorRequest } from './supervisorCommandModel';

const CUSTOMER_MOVEMENT_TYPES = new Set(['VENTA_FIADA', 'COBRO_DEUDA']);

export async function queueSupervisorCustomerMovementVoid({
    supabase, primaryDeviceId, monitorDeviceId, sale, customerId, actor = {}, reason, commandId,
}) {
    if (!supabase) throw new Error('La conexión Cloud no está configurada.');
    if (!primaryDeviceId || !monitorDeviceId) throw new Error('No hay una identidad Supervisor y una caja emparejada válidas.');
    if (!sale?.id || !CUSTOMER_MOVEMENT_TYPES.has(sale.tipo)) {
        throw new Error('Solo se pueden anular créditos o abonos de clientes desde este historial.');
    }
    const recordedCustomerId = sale.customerId || sale.clienteId;
    if (!customerId || recordedCustomerId !== customerId) {
        throw new Error('No se puede verificar a qué cliente pertenece este movimiento.');
    }
    if (sale.status === 'ANULADA') throw new Error('Este movimiento ya fue anulado.');
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) throw new Error('Escribe el motivo de la anulación.');
    if (cleanReason.length > 240) throw new Error('El motivo no puede superar 240 caracteres.');
    if (!commandId) throw new Error('No se pudo asignar un identificador a la anulación.');

    const safeActor = actor && typeof actor === 'object' ? actor : {};
    const row = {
        id: commandId,
        primary_device_id: primaryDeviceId,
        monitor_device_id: monitorDeviceId,
        command_type: 'void_sale',
        status: 'pending',
        payload: {
            commandId,
            saleId: sale.id,
            customerMovementVoid: true,
            customerId,
            customerTransactionId: sale.customerTransactionId || null,
            reason: cleanReason,
            supervisorId: safeActor.id || null,
            supervisorName: safeActor.nombre || safeActor.usuario || 'Supervisor',
            supervisorRole: safeActor.rol || 'SUPERVISOR',
        },
    };
    const resolveStoredRequest = async isDuplicate => {
        const { data, error } = await supabase.from('supervisor_commands')
            .select('id,primary_device_id,monitor_device_id,command_type,payload,status')
            .eq('id', row.id).maybeSingle();
        if (!error && sameSupervisorRequest(data, row)) return { commandId: row.id, saleId: sale.id, status: data.status };
        if (isDuplicate) throw new Error(error?.message || 'El identificador de anulación ya existe con otro contenido.');
        throw new Error(error?.message || 'No se pudo confirmar si la caja recibió la anulación.');
    };

    let insertError;
    try {
        ({ error: insertError } = await supabase.from('supervisor_commands').insert(row));
    } catch (error) {
        try { return await resolveStoredRequest(false); }
        catch (resolveError) {
            throw new Error(resolveError.message || error?.message || 'No se pudo confirmar el envío de la anulación.');
        }
    }
    if (!insertError) return { commandId: row.id, saleId: sale.id, status: 'pending' };
    if (insertError.code === '23505') return resolveStoredRequest(true);
    if (!insertError.code) return resolveStoredRequest(false);
    throw new Error(insertError.message || 'La caja rechazó la anulación.');
}
