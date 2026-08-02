/**
 * searchUtils.js — Motor de Búsqueda Inteligente para Productos
 *
 * Proporciona tokenización multi-palabra, normalización de acentos (NFD)
 * y coincidencia flexible sobre múltiples campos del producto (nombre, barras, categoría, id).
 */

/**
 * Normaliza un texto removiendo acentos/diacríticos y convirtiendo a minúsculas.
 * @param {string} str
 * @returns {string} Texto limpio
 */
export function normalizeSearchText(str) {
    if (!str) return '';
    const cleaned = String(str)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    // Normalizar números pegados a unidades (ej: "1 kg" <-> "1kg", "355 ml" <-> "355ml")
    return cleaned.replace(/(\d+)\s*(kg|g|gr|ml|l|cc|oz|lb|pcs|u|unid|uds)\b/g, '$1$2 $1 $2');
}

/**
 * Evalúa si un producto coincide con una consulta de búsqueda multi-palabra (multi-token).
 *
 * REGLAS:
 * 1. Si la consulta es vacía, no coincide (o devuelve false).
 * 2. Si la consulta es exactamente igual al código de barras (unidad, caja, media caja) o ID, coincide de inmediato.
 * 3. Si la consulta tiene múltiples palabras (ej: "detodito grande", "polar 355", "queso 1kg"),
 *    CADA palabra debe encontrarse dentro de la combinación de campos del producto (nombre, barras, categoría, id).
 * 4. Insensible a acentos/diacríticos (ej: "jamon" coincide con "Jamón").
 *
 * @param {Object} product - Objeto producto a evaluar
 * @param {string} searchTerm - Consulta de búsqueda ingresada
 * @returns {boolean} True si coincide con todos los términos.
 */
export function matchProductSearch(product, searchTerm) {
    if (!product || !searchTerm) return false;
    const rawQuery = String(searchTerm).trim();
    if (!rawQuery) return false;

    // Coincidencia rápida exacta de código de barras o ID
    if (
        (product.barcode && String(product.barcode).trim() === rawQuery) ||
        (product.boxBarcode && String(product.boxBarcode).trim() === rawQuery) ||
        (product.halfBoxBarcode && String(product.halfBoxBarcode).trim() === rawQuery) ||
        (product.id && String(product.id).trim() === rawQuery)
    ) {
        return true;
    }

    const cleanQuery = normalizeSearchText(searchTerm);
    if (!cleanQuery) return false;

    // Texto unificado que concentra todos los atributos buscables del producto
    const fieldsText = normalizeSearchText(
        [
            product.name,
            product.barcode,
            product.boxBarcode,
            product.halfBoxBarcode,
            product.category,
            product.description,
            product.id,
            product.sku,
            product.code
        ].filter(Boolean).join(' ')
    );

    // Fragmentar la consulta en tokens (palabras independientes)
    const tokens = cleanQuery.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return false;

    // Verificar que TODAS las palabras ingresadas existan en el texto del producto
    return tokens.every(token => fieldsText.includes(token));
}
