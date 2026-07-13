# Plan Maestro: Rediseño de Creación y Edición de Artículos para Licorería

Este plan detalla el rediseño del formulario de creación y edición de productos para adaptarlo al contexto de una licorería venezolana (Donde Juancho POS).

---

## 1. Resumen de Cambios de Interfaz y Nomenclatura

| Elemento Actual | Nuevo Estado |
|---|---|
| Auto-Buscar Foto (Sparkles) | **Eliminado** del formulario |
| Tipo Empaque: Suelto / Bulto / Granel | **Eliminado**. Granel se oculta (activable en Ajustes). Suelto/Bulto reemplazados por toggles. |
| Precio único USD (auto-convierte a Bs) | **Precios independientes**: USD y Bs separados para cada formato |
| Un solo código de barras | **Código de barras por formato**: Unidad, Caja, ½ Caja |
| Placeholder "Harina PAN 1kg" | **"Ej: Ron Santa Teresa 750ml"** |
| Label "Bulto" | **"Caja"** en toda la app |

---

## 2. Decisiones Confirmadas ✅

> [!NOTE]
> **Migración de datos**: NO se requiere migración de productos existentes por tratarse de un sistema nuevo.

> [!NOTE]
> **Precio Bs en pagos 100% Bs**: Cuando el cajero cobra 100% en métodos de bolívares (`efectivo_bs`, `pago_movil`, `punto_venta`), el sistema SIEMPRE tomará el **precio Bs manual** (`priceBsManual`). Si el producto no tiene un precio Bs manual definido, se usará la conversión automática por tasa BCV como fallback secundario.

> [!NOTE]
> **COP (Pesos Colombianos)**: Se **ocultan** todos los campos de COP del formulario de creación/edición. Se elimina `priceCop`, `unitPriceCop`, `costCop` y hooks asociados. Los campos de cobro/visualización en COP en el checkout también se ocultan en la interfaz ordinaria.

---

## 3. Modelo de Datos del Producto Resultante

El payload del producto generado por `productProcessor.js` será el siguiente:

```javascript
{
  name: "Polar Light Tercio",
  barcode: "7591001000123",       // Código de barras UNIDAD
  priceUsd: 1.50,                 // Precio unidad en USD
  priceUsdt: 1.50,                // Alias legacy para compatibilidad
  priceBsManual: 55.00,           // Precio unidad en Bs (MANUAL, independiente de tasa)
  costUsd: 1.00,
  costBs: 38.00,
  stock: 327,
  
  // ── FORMATO CAJA ──
  sellByBox: false,               // Toggle: ¿Se vende por caja?
  boxUnits: 36,                   // Unidades por caja
  boxBarcode: "7591001000456",    // Código de barras CAJA
  boxPriceUsd: 45.00,             // Precio caja en USD
  boxPriceBs: 1700.00,            // Precio caja en Bs (MANUAL)
  
  // ── FORMATO ½ CAJA ──
  sellByHalfBox: false,           // Toggle: ¿Se vende por ½ caja?
  halfBoxUnits: 18,               // Unidades por ½ caja
  halfBoxBarcode: "7591001000789",// Código de barras ½ CAJA
  halfBoxPriceUsd: 24.00,         // Precio ½ caja en USD
  halfBoxPriceBs: 900.00,         // Precio ½ caja en Bs (MANUAL)
  
  // ── LEGACY ──
  packagingType: 'suelto',
  unit: 'unidad',
  category: 'cervezas',
  lowStockAlert: 5
}
```

---

## 4. Archivos Clave a Modificar

### Formulario y Creación de Producto
1. `src/components/Products/ProductFormQuick.jsx`
   * Quitar la zona de Auto-Buscar Foto (haciendo que subir foto ocupe el ancho completo).
   * Omitir el selector de empaque (Suelto/Bulto/Granel).
   * Implementar los toggles de Caja y ½ Caja que despliegan inputs de:
     * Unidades, Código de barra propio, Precio USD y Precio Bs (manual).
   * Cambiar placeholders a licores populares.

2. `src/components/Products/ProductFormWizard.jsx`
   * Replicar los cambios de toggles, ocultado de COP y auto-foto.

3. `src/components/Products/ProductFormModal.jsx`
   * Administrar los nuevos estados (`sellByBox`, `boxUnits`, `boxBarcode`, etc.) y pasarlos a los sub-formularios.

4. `src/views/ProductsView.jsx`
   * En `handleSave()`, pasar los nuevos campos al procesador.
   * En `handleEdit()`, inicializar los nuevos estados a partir de la data del producto seleccionado.

### Lógica de Ventas y Facturación
5. `src/views/SalesView.jsx`
   * En `addToCart()`, expandir la búsqueda de código de barras a `barcode`, `boxBarcode` y `halfBoxBarcode` para detectar el formato escaneado.
   * Si el artículo tiene Caja o ½ Caja y se hace clic en la grilla, desplegar un modal de selección de formato para agregar a cesta.
   * Pasar los precios USD y Bs de forma explícita al carrito.

6. `src/utils/checkoutProcessor.js`
   * En compras pagadas 100% en Bs, recalcular el total usando los precios Bs manuales de cada artículo.
   * En compras mixtas, aplicar la **Regla de Referencia USD**:
     1. El total se calcula usando el precio en USD.
     2. Se restan los dólares pagados.
     3. El saldo sobrante se convierte a Bs usando la tasa de cambio del momento.

7. `src/components/Settings/tabs/SettingsTabSistema.jsx`
   * Agregar toggle para activar/desactivar venta a Granel (deshabilitado por defecto).

8. `src/components/Products/ProductCard.jsx`
   * Mostrar badges informativos de disponibilidad por Caja/Media Caja.
   * Mostrar ambos precios (USD y Bs) en la lista de catálogo.

---

## 5. Plan de Verificación

1. **Creación de Producto:** Crear "Cerveza Zulia" con precio individual de $1.50 / 55 Bs. Activar Caja (36 uds) a $45.00 / 1700 Bs. Activar ½ Caja (18 uds) a $24.00 / 900 Bs.
2. **Escaneo de Códigos:** Escanear el código de barra de la caja y verificar que se añade la caja directamente con sus respectivos precios.
3. **Flujo de Pago 100% Bs:** Pagar con Pago Móvil y verificar que el total cobrado sea 55 Bs (unidad) o 1700 Bs (caja).
4. **Flujo de Pago Mixto:** Cobrar una caja ($45.00). Pagar $20 USD en efectivo y el resto en Bs. Comprobar que el saldo restante ($25) se calcule a Bs según la tasa de cambio activa.
