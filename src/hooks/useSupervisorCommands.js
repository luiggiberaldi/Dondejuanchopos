import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { applyInventoryCommand } from '../utils/remoteInventoryProcessor';

// ── Deduplicación por ID de comando ─────────────────────────────────────────
// El catch-up (select de pendientes) y el stream realtime pueden entregar el
// MISMO comando dos veces. Para rate_change re-aplicar es inofensivo (valor
// absoluto), pero inventory_update con deltas de stock corrompería datos.
// Registramos los últimos IDs aplicados en localStorage ANTES de marcar
// 'applied' en Supabase, así un fallo del UPDATE remoto tampoco re-aplica.
const APPLIED_IDS_KEY = 'dj_applied_supervisor_cmds_v1';
const APPLIED_IDS_MAX = 200;

function loadAppliedIds() {
    try {
        const raw = localStorage.getItem(APPLIED_IDS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

function markApplied(commandId) {
    try {
        const arr = loadAppliedIds().filter(id => id !== commandId);
        arr.push(commandId);
        while (arr.length > APPLIED_IDS_MAX) arr.shift();
        localStorage.setItem(APPLIED_IDS_KEY, JSON.stringify(arr));
    } catch { /* localStorage lleno/bloqueado: el Set en memoria sigue protegiendo la sesión */ }
}

async function updateCommandStatus(commandId, status, errorReason = null) {
    const fields = { status };
    if (status === 'applied') fields.applied_at = new Date().toISOString();
    if (errorReason) fields.error_reason = String(errorReason).slice(0, 500);
    try {
        await supabaseCloud
            .from('supervisor_commands')
            .update(fields)
            .eq('id', commandId);
    } catch (e) {
        console.error('[SupervisorCommands] No se pudo actualizar status:', e);
    }
}

async function applyRateChange(command) {
    const { rateMode, customRate } = command.payload || {};

    let pushLocalSync = null;
    try {
        const syncModule = await import('./useCloudSync');
        pushLocalSync = syncModule.pushLocalSync;
    } catch (e) {
        console.error('[SupervisorCommands] Error al importar dinámicamente pushLocalSync:', e);
    }

    if (rateMode) {
        localStorage.setItem('bodega_rate_mode', rateMode);
        localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode !== 'manual'));
        if (pushLocalSync) {
            pushLocalSync('bodega_rate_mode', rateMode);
            pushLocalSync('bodega_use_auto_rate', rateMode !== 'manual');
        }
    }

    if (customRate !== undefined && customRate !== null) {
        localStorage.setItem('bodega_custom_rate', String(customRate));
        if (pushLocalSync) {
            pushLocalSync('bodega_custom_rate', parseFloat(customRate));
        }
    }

    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));
    window.dispatchEvent(new CustomEvent('supervisor_rate_applied', {
        detail: { rateMode, customRate }
    }));
}

export function useSupervisorCommands(deviceId) {
    useEffect(() => {
        if (!supabaseCloud || !deviceId) return;

        // Set en memoria sembrado desde localStorage (sobrevive recargas)
        const appliedIds = new Set(loadAppliedIds());
        let disposed = false;

        const processCommand = async (command) => {
            if (!command || command.status !== 'pending') return;
            if (appliedIds.has(command.id)) return; // dedup: catch-up + realtime

            if (command.command_type === 'rate_change') {
                try {
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    await applyRateChange(command);
                    await updateCommandStatus(command.id, 'applied');
                } catch (err) {
                    console.error('[SupervisorCommands] Error al aplicar rate_change:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            } else if (command.command_type === 'inventory_update') {
                try {
                    appliedIds.add(command.id);
                    markApplied(command.id);
                    const result = await applyInventoryCommand(command.payload);
                    if (result.success) {
                        await updateCommandStatus(command.id, 'applied');
                        window.dispatchEvent(new CustomEvent('supervisor_inventory_applied', {
                            detail: {
                                action: command.payload?.action,
                                productName: result.productName || ''
                            }
                        }));
                    } else {
                        await updateCommandStatus(command.id, 'failed', result.error);
                    }
                } catch (err) {
                    console.error('[SupervisorCommands] Error al aplicar inventory_update:', err);
                    await updateCommandStatus(command.id, 'failed', err?.message);
                }
            }
            // Tipos desconocidos: se ignoran (comportamiento histórico)
        };

        // Catch-up: el realtime de Supabase NO re-emite INSERTs perdidos
        // (caja cerrada u offline). Al montar y en cada (re)suscripción se
        // consultan los comandos aún pendientes y se procesan en orden.
        const catchUpPending = async () => {
            try {
                const { data, error } = await supabaseCloud
                    .from('supervisor_commands')
                    .select('*')
                    .eq('primary_device_id', deviceId)
                    .eq('status', 'pending')
                    .order('created_at', { ascending: true });
                if (error || disposed) return;
                for (const command of data || []) {
                    await processCommand(command);
                }
            } catch (err) {
                console.error('[SupervisorCommands] Error en catch-up:', err);
            }
        };

        const channel = supabaseCloud
            .channel(`supervisor_commands:${deviceId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `primary_device_id=eq.${deviceId}`
            }, (payload) => processCommand(payload.new))
            .subscribe((status) => {
                // SUBSCRIBED se emite al conectar Y al reconectar: cubre los
                // comandos que llegaron mientras el websocket estuvo caído.
                if (status === 'SUBSCRIBED') catchUpPending();
            });

        return () => {
            disposed = true;
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId]);
}
