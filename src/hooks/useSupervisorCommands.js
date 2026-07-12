import { useEffect } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { pushLocalSync } from './useCloudSync';

export function useSupervisorCommands(deviceId) {
    useEffect(() => {
        if (!supabaseCloud || !deviceId) return;

        // Suscribirse a la tabla de comandos para este dispositivo (caja)
        const channel = supabaseCloud
            .channel(`supervisor_commands:${deviceId}`)
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `primary_device_id=eq.${deviceId}`
            }, async (payload) => {
                const command = payload.new;
                if (!command || command.status !== 'pending') return;

                if (command.command_type === 'rate_change') {
                    const { rateMode, customRate } = command.payload || {};
                    
                    try {
                        // 1. Aplicar la nueva configuración de tasa localmente
                        if (rateMode) {
                            localStorage.setItem('bodega_rate_mode', rateMode);
                            localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode !== 'manual'));
                            pushLocalSync('bodega_rate_mode', rateMode);
                            pushLocalSync('bodega_use_auto_rate', rateMode !== 'manual');
                        }
                        
                        if (customRate !== undefined && customRate !== null) {
                            localStorage.setItem('bodega_custom_rate', String(customRate));
                            pushLocalSync('bodega_custom_rate', parseFloat(customRate));
                        }

                        // 2. Marcar como aplicado en Supabase
                        await supabaseCloud
                            .from('supervisor_commands')
                            .update({ 
                                status: 'applied',
                                applied_at: new Date().toISOString()
                            })
                            .eq('id', command.id);

                        // 3. Notificar a toda la interfaz local (incluye ProductContext y banner)
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_rate_mode' } }));
                        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_custom_rate' } }));
                        
                        // Despachar evento personalizado para el banner
                        window.dispatchEvent(new CustomEvent('supervisor_rate_applied', {
                            detail: { rateMode, customRate }
                        }));
                    } catch (err) {
                        console.error('[SupervisorCommands] Error al aplicar comando:', err);
                        try {
                            await supabaseCloud
                                .from('supervisor_commands')
                                .update({ status: 'failed' })
                                .eq('id', command.id);
                        } catch (e) {}
                    }
                }
            })
            .subscribe();

        return () => {
            supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [deviceId]);
}
