/**
 * Helpers compartidos para normalizar precios Bs por formato.
 *
 * El catálogo histórico usa los aliases `boxPriceBsManual` y
 * `halfBoxPriceBsManual`, mientras que el contrato actual usa
 * `boxPriceBs` y `halfBoxPriceBs`. La lectura siempre debe aceptar ambos;
 * la migración materializa el campo canónico sin eliminar el legacy.
 */

export function readPositiveMoney(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) return number;
    }
    return null;
}

const FORMAT_PRICE_KEYS = {
    box: { canonical: 'boxPriceBs', legacy: 'boxPriceBsManual' },
    halfBox: { canonical: 'halfBoxPriceBs', legacy: 'halfBoxPriceBsManual' },
};

export function resolveFormatBsPrice(product = {}, format) {
    const keys = FORMAT_PRICE_KEYS[format];
    if (!keys) return null;
    return readPositiveMoney(product?.[keys.canonical], product?.[keys.legacy]);
}

export function getFormatPriceAliasConflicts(product = {}) {
    return Object.entries(FORMAT_PRICE_KEYS).flatMap(([format, keys]) => {
        const canonical = readPositiveMoney(product?.[keys.canonical]);
        const legacy = readPositiveMoney(product?.[keys.legacy]);
        if (canonical === null || legacy === null || canonical === legacy) return [];
        return [{
            format,
            canonicalKey: keys.canonical,
            legacyKey: keys.legacy,
            canonicalValue: canonical,
            legacyValue: legacy,
        }];
    });
}

export function migrateFormatPriceAliases(product = {}) {
    const next = { ...product };

    for (const keys of Object.values(FORMAT_PRICE_KEYS)) {
        const resolved = readPositiveMoney(product?.[keys.canonical], product?.[keys.legacy]);
        if (resolved !== null) {
            next[keys.canonical] = resolved;
        } else if (Object.prototype.hasOwnProperty.call(product, keys.canonical)) {
            // Conserva la forma explícita que ya tenía el producto, pero evita
            // dejar strings vacíos o valores no numéricos en el contrato canónico.
            next[keys.canonical] = null;
        }
    }

    return next;
}
