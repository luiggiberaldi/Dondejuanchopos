/**
 * Serializa tareas asíncronas por clave sin bloquear claves independientes.
 * Una tarea rechazada no rompe las siguientes de la misma clave.
 */
export function createAsyncKeyQueue() {
    const chains = new Map();

    return (key, task) => {
        const previous = chains.get(key) || Promise.resolve();
        const current = previous
            .catch(() => undefined)
            .then(() => task());

        chains.set(key, current);
        current.then(
            () => { if (chains.get(key) === current) chains.delete(key); },
            () => { if (chains.get(key) === current) chains.delete(key); },
        );
        return current;
    };
}
