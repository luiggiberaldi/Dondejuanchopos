import React from 'react';
import RemoteKardexPanel from './RemoteKardexPanel';

/**
 * Pestaña "Kardex Remoto" del Monitor de Supervisión:
 * consulta del kardex bajo demanda contra la caja principal.
 */
export default function MonitorKardexTab({ pairedDeviceId, triggerHaptic }) {
    return (
        <RemoteKardexPanel
            deviceId={pairedDeviceId}
            triggerHaptic={triggerHaptic}
        />
    );
}
