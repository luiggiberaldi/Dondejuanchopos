import { sameSupervisorRequest } from './supervisorCommandModel';

export async function queueSupervisorCustomerTransaction({ supabase, primaryDeviceId, monitorDeviceId, payload }) {
    if (!supabase) throw new Error('La conexión Cloud no está configurada.');
    if (!primaryDeviceId || !monitorDeviceId) throw new Error('No hay una identidad Supervisor y una caja emparejada válidas.');
    if (!payload?.commandId || !payload?.record?.id || !payload.customerId) throw new Error('Faltan datos para identificar el movimiento.');
    const row = {
        id: payload.commandId,
        primary_device_id: primaryDeviceId,
        monitor_device_id: monitorDeviceId,
        command_type: 'inventory_update',
        payload,
        status: 'pending',
    };
    const resolveStoredRequest = async duplicate => {
        const { data, error } = await supabase.from('supervisor_commands')
            .select('id,primary_device_id,monitor_device_id,command_type,payload,status')
            .eq('id', row.id).maybeSingle();
        if (!error && sameSupervisorRequest(data, row)) return { commandId: row.id, status: data.status };
        if (duplicate) throw new Error(error?.message || 'El identificador ya existe con otro contenido; no se duplicó el envío.');
        throw new Error(error?.message || 'El resultado del envío no pudo confirmarse de forma segura.');
    };


    let insertError;
    try {
        ({ error: insertError } = await supabase.from('supervisor_commands').insert(row));
    } catch (error) {
        // The server may have accepted the insert even though its response was lost.
        try { return await resolveStoredRequest(false); }
        catch (resolveError) {
            throw new Error(resolveError.message || error?.message || 'No se pudo confirmar si la caja recibió el movimiento.');
        }
    }
    if (!insertError) return { commandId: row.id, status: 'pending' };
    if (insertError.code === '23505') return resolveStoredRequest(true);
    if (!insertError.code) return resolveStoredRequest(false);
    throw new Error(insertError.message || 'La caja rechazó el comando.');
}
