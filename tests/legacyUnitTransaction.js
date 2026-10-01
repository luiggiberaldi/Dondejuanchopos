// Adaptador SOLO para pruebas unitarias históricas de cálculos y flujos.
// Conserva los spies/faults del store simulado y añade read-your-writes.
// NO simula atomicidad ni valida recovery: localTransaction/transactionBusiness
// importan el núcleo real y prueban esas garantías con E/S controlada.
export async function runLegacyUnitTransaction(base, callback) {
    const written = new Map();
    const effects = [];
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const io = {
        getItem: async (key, fallback = null) => written.has(key) ? clone(written.get(key)) : base.getItem(key, fallback),
        async setItem(key, value) { await base.setItem(key, value); written.set(key, clone(value)); },
        async removeItem(key) { await base.removeItem(key); written.set(key, null); },
        afterCommit: effect => effects.push(effect),
    };
    const result = await callback(io);
    if (!(result?.error || result?.success === false)) for (const effect of effects) await effect();
    return result;
}
