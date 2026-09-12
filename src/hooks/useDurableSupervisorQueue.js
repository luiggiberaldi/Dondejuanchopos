import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeSupervisorChanges } from '../utils/supervisorCommandModel';

export const SUPERVISOR_QUEUE_KEY = 'dj_supervisor_queue_v2';
export const LEGACY_PENDING_KEY = 'dj_pending_inventory_changes_v1';
export const LEGACY_INFLIGHT_KEY = 'dj_inflight_inventory_changes_v1';
export const LEGACY_QUEUE_OWNER_KEY = 'dj_supervisor_queue_legacy_owner_v2';

function normalize(state) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.pending) || !Array.isArray(state.inFlight)) {
        throw new Error('La cola guardada no tiene un formato válido. Se conserva para recuperación.');
    }
    const list = items => {
        if (items.some(c => !c || typeof c !== 'object' || typeof c.action !== 'string')) {
            throw new Error('La cola contiene un comando ilegible. Se conserva para recuperación.');
        }
        return normalizeSupervisorChanges(items);
    };
    const inFlight = list(state.inFlight);
    const inFlightIds = new Set(inFlight.map(c => c.commandId));
    const unique = items => [...new Map(items.map(c => [c.commandId, c])).values()];
    return {
        pending: unique(list(state.pending).filter(c => !inFlightIds.has(c.commandId))),
        inFlight: unique(inFlight),
    };
}

function readQueue(key, scope) {
    const raw = localStorage.getItem(key);
    if (raw !== null) return { state: normalize(JSON.parse(raw)), migrate: false };
    const owner = localStorage.getItem(LEGACY_QUEUE_OWNER_KEY);
    // Las claves antiguas no tienen ámbito. Solo se pueden adoptar una vez,
    // por la vinculación activa en la migración; las copias se conservan intactas.
    if (owner && owner !== scope) return { state: { pending: [], inFlight: [] }, migrate: false };
    if (!owner) {
        for (let i = 0; i < localStorage.length; i++) {
            if (localStorage.key(i)?.startsWith(`${SUPERVISOR_QUEUE_KEY}:`)) {
                return { state: { pending: [], inFlight: [] }, migrate: false };
            }
        }
    }
    return {
        state: normalize({
            pending: JSON.parse(localStorage.getItem(LEGACY_PENDING_KEY) || '[]'),
            inFlight: JSON.parse(localStorage.getItem(LEGACY_INFLIGHT_KEY) || '[]'),
        }),
        migrate: true,
    };
}

// Pendientes y enviados se guardan juntos: cerrar la página no puede dejar un
// comando entre dos listas. La antigüedad nunca equivale a rechazo de la caja.
export function useDurableSupervisorQueue(deviceId) {
    const monitorId = localStorage.getItem('dj_device_id');
    const scope = `${deviceId || ''}:${monitorId || ''}`;
    const key = `${SUPERVISOR_QUEUE_KEY}:${scope}`;
    const [initial] = useState(() => {
        try { return { ...readQueue(key, scope), scope, error: null }; }
        catch (error) { return { state: { pending: [], inFlight: [] }, scope, error }; }
    });
    const [state, setState] = useState(initial.state);
    const [error, setError] = useState(initial.error);
    const ref = useRef(initial.state);
    const activeRef = useRef(false);

    const assertScope = useCallback(() => {
        if (!activeRef.current || initial.scope !== scope
            || localStorage.getItem('dj_paired_device_id') !== deviceId
            || localStorage.getItem('dj_device_id') !== monitorId) {
            throw new Error('La sesión o la vinculación cambió. Recarga el supervisor antes de enviar.');
        }
    }, [deviceId, monitorId, scope, initial.scope]);

    const update = useCallback(transform => {
        assertScope();
        if (initial.error) throw initial.error;
        const raw = localStorage.getItem(key);
        const current = raw === null ? ref.current : normalize(JSON.parse(raw));
        const next = normalize(transform(current));
        const serialized = JSON.stringify(next);
        // Reservar el origen ANTES de escribir v2. Si la segunda escritura falla,
        // solo este mismo ámbito podrá volver a migrar, nunca otra caja.
        if (initial.migrate && !localStorage.getItem(LEGACY_QUEUE_OWNER_KEY)) {
            localStorage.setItem(LEGACY_QUEUE_OWNER_KEY, scope);
        }
        localStorage.setItem(key, serialized); // Si falla, no publicar estado ni enviar.
        const committed = JSON.parse(serialized);
        ref.current = committed;
        setState(committed); // Sin efectos dentro de actualizadores de React.
        setError(null);
        return committed;
    }, [assertScope, key, scope, initial.error, initial.migrate]);

    useEffect(() => {
        activeRef.current = true;
        if (!initial.error && initial.scope === scope) {
            try { update(current => current); } catch (failure) { setError(failure); }
        }
        const onStorage = event => {
            if (event.key !== key) return;
            try {
                // Leer el valor actual, no un evento atrasado de otra pestaña.
                const raw = localStorage.getItem(key);
                if (raw === null) return;
                const next = normalize(JSON.parse(raw));
                ref.current = next;
                setState(next);
            } catch (failure) { setError(failure); }
        };
        window.addEventListener('storage', onStorage);
        return () => {
            activeRef.current = false;
            window.removeEventListener('storage', onStorage);
        };
    }, [key, scope, initial.error, initial.scope, update]);

    return { state, ref, update, key, error, assertScope };
}
