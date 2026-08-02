# Informe de Auditoría — Buscador de Productos (Búsqueda Multi-Palabra)

**Fecha**: 1 de Agosto, 2026  
**Módulo Auditado**: Búsqueda de Productos (`ComboFormModal.jsx`, `useProductFiltering.js`, `SalesView.jsx`)  
**Estado**: 🔴 Defecto Identificado (Causa Raíz Diagnosticada)

---

## 1. Descripción del Problema
Cuando el usuario intenta buscar un producto escribiendo **más de 2 palabras** (ej: `"polar 355"`, `"ron santa teresa"`, `"harina 1kg"`), el buscador deja de mostrar resultados y los artículos desaparecen del listado/dropdown.

---

## 2. Causa Raíz Diagnosticada (Evidencia en Código)

### Hallazgo A: Contigüidad Rígida de Cadenas (`includes(term)`)
En `ComboFormModal.jsx` (línea 79) y `useProductFiltering.js` (línea 9):
```javascript
p.name.toLowerCase().includes(term)
```
- **Falla**: Busca la cadena `term` como un único bloque de texto contiguo.
- **Caso Real**: Si el producto se llama `"Cerveza Polar Pilsen 355ml"` y el usuario escribe `"polar 355"`, la función compara si `"polar pilsen 355ml"` contiene el subtexto exacto `"polar 355"`. Como entre `"polar"` y `"355"` existe la palabra `"pilsen "`, la condición evalúa a `false` y el producto no aparece.

### Hallazgo B: Sensibilidad a Acentos y Caracteres Diacríticos
En `ComboFormModal.jsx` y `useProductFiltering.js`, el término buscado no se normaliza con `.normalize("NFD")`.
- **Falla**: Si un producto fue guardado como `"Jamón Planchado"` o `"Cerveza Fría"` y el usuario escribe `"jamon"` o `"fria"`, el buscador retorna 0 resultados.

### Hallazgo C: Búsqueda Mono-Campo en Módulos de Combos y Formularios
En `ComboFormModal.jsx` (línea 79), la búsqueda filtra **únicamente** por la propiedad `p.name`.
- **Falla**: Si el usuario intenta buscar por código de barras (`barcode`), código de caja (`boxBarcode`), categoría o SKU mientras arma un combo, el producto es omitido por completo.

---

## 3. Solución Técnica Diseñada

Crear una utilidad central de búsqueda `src/utils/searchUtils.js` que implemente **Tokenización Multi-Palabra y Normalización NFD**:

```javascript
export function matchProductSearch(product, searchTerm) {
    if (!product || !searchTerm) return false;
    const cleanQuery = normalizeSearchText(searchTerm);
    if (!cleanQuery) return false;

    // Texto unificado de todos los campos del producto
    const fieldsText = normalizeSearchText(
        [product.name, product.barcode, product.boxBarcode, product.halfBoxBarcode, product.category, product.id]
            .filter(Boolean).join(' ')
    );

    // Cada palabra ingresada por el usuario debe existir en alguno de los campos
    const tokens = cleanQuery.split(/\s+/).filter(Boolean);
    return tokens.every(token => fieldsText.includes(token));
}
```

### Ventajas:
1. **Flexibilidad Total**: `"polar 355"` encontrará `"Cerveza Polar Pilsen 355ml"`.
2. **Independencia del Orden**: `"355 polar"` también encontrará `"Cerveza Polar Pilsen 355ml"`.
3. **Insensible a Acentos**: `"jamon"` encontrará `"Jamón"`.
4. **Búsqueda Multi-Campo**: Busca simultáneamente por Nombre, Código de Barras, Código de Caja, Categoría e ID.

---

## 4. Plan de Implementación (4 Fases)

- **Fase B1 (Primitiva Central de Búsqueda)**: Crear `src/utils/searchUtils.js`.
- **Fase B2 (Integración en Combos)**: Reemplazar el filtro en `ComboFormModal.jsx`.
- **Fase B3 (Integración en POS & Inventario)**: Reemplazar los filtros en `SalesView.jsx` y `useProductFiltering.js`.
- **Fase B4 (Pruebas & Verificación)**: Crear `tests/productSearch.test.js` con 100% de cobertura en búsquedas complejas.
