/**
 * Decide si un documento sincronizado puede reemplazar la versión actual.
 * Las versiones vienen del `updated_at` del servidor, por lo que nunca se
 * debe comparar con el reloj local del dispositivo.
 */
export function shouldApplySyncVersion(currentVersion, incomingVersion) {
    if (!incomingVersion) return currentVersion == null;
    if (!currentVersion) return true;

    const current = Date.parse(currentVersion);
    const incoming = Date.parse(incomingVersion);

    if (!Number.isFinite(current) || !Number.isFinite(incoming)) return false;
    return incoming >= current;
}

export function isNewerSyncVersion(currentVersion, incomingVersion) {
    if (!incomingVersion) return false;
    if (!currentVersion) return true;

    const current = Date.parse(currentVersion);
    const incoming = Date.parse(incomingVersion);
    return Number.isFinite(current) && Number.isFinite(incoming) && incoming > current;
}
