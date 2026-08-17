/**
 * src/utils/userCatalog.js
 * SEC-002: ni el hash PBKDF2 (`pin`) ni el PIN en claro (`plainPin`) salen del
 * dispositivo. `bodega_users_catalog_v1` se publica en sync_documents, que es
 * legible por el rol anon. El monitor sólo necesita id, nombre, rol y bypassPin.
 */
export function sanitizeUserCatalog(users) {
    return (users || []).map(({ pin, plainPin, ...rest }) => ({
        ...rest,
        rol: rest.rol || (rest.id === 1 ? 'ADMIN' : 'CAJERO'),
    }));
}
