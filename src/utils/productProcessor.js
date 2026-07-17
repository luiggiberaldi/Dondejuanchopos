// FIN-017: Reemplaza Math.round(raw/safeRate*100)/100 por divR + round2 de dinero.js.
// FIN-030: Mantiene `priceUsdt` (typo histórico) pero añade alias `priceUsd` (mismo valor)
//          para migración gradual hacia el nombre canónico.
import { round2, divR, mulR } from './dinero';
import { CurrencyService } from '../services/CurrencyService'; // FIN-017-pattern: safeParse en vez de parseFloat.

export function buildProductPayload(formData, effectiveRate) {
    const {
        name,
        barcode,
        priceUsd,
        priceBsManual,
        costUsd,
        costBs,
        stock,
        category,
        lowStockAlert,
        
        sellByBox,
        boxUnits,
        boxBarcode,
        boxPriceUsd,
        boxPriceBs,
        
        sellByHalfBox,
        halfBoxUnits,
        halfBoxBarcode,
        halfBoxPriceUsd,
        halfBoxPriceBs,

        purchaseByBoxCost,
        purchaseBoxUnits,
        purchaseBoxBcv,
        forceBcv
    } = formData;

    const formattedName = name.replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase());
    const safeRate = effectiveRate > 0 ? effectiveRate : 1;

    // Normalizar costos y precios de unidad
    const finalPriceUsd = priceUsd ? round2(CurrencyService.safeParse(priceUsd)) : 0;
    const finalPriceBsManual = priceBsManual ? round2(CurrencyService.safeParse(priceBsManual)) : null;

    // Normalizar datos de Caja (para usarse en la conversión del costo)
    const parsedBoxUnits = sellByBox && boxUnits ? parseInt(boxUnits, 10) : 1;
    const boxUnitsCount = parsedBoxUnits > 0 ? parsedBoxUnits : 1;

    const baseCostUsd = costUsd ? round2(CurrencyService.safeParse(costUsd)) : 0;
    const baseCostBs = costBs
        ? round2(CurrencyService.safeParse(costBs))
        : (costUsd ? mulR(CurrencyService.safeParse(costUsd), safeRate) : 0);

    // Si se usó la calculadora de compra por caja, los costos en el formulario ya son unitarios.
    const isAlreadyUnitCost = purchaseByBoxCost && purchaseBoxUnits;
    const finalCostUsd = (sellByBox && !isAlreadyUnitCost) ? round2(divR(baseCostUsd, boxUnitsCount)) : baseCostUsd;
    const finalCostBs = (sellByBox && !isAlreadyUnitCost) ? round2(divR(baseCostBs, boxUnitsCount)) : baseCostBs;

    // Normalizar datos de Caja
    const finalBoxPriceUsd = sellByBox && boxPriceUsd ? round2(CurrencyService.safeParse(boxPriceUsd)) : null;
    const finalBoxPriceBs = sellByBox && boxPriceBs ? round2(CurrencyService.safeParse(boxPriceBs)) : null;
    const finalBoxBarcode = sellByBox && boxBarcode ? boxBarcode.trim() : null;

    // Normalizar datos de Media Caja
    const parsedHalfBoxUnits = sellByHalfBox && halfBoxUnits ? parseInt(halfBoxUnits, 10) : 1;
    const finalHalfBoxPriceUsd = sellByHalfBox && halfBoxPriceUsd ? round2(CurrencyService.safeParse(halfBoxPriceUsd)) : null;
    const finalHalfBoxPriceBs = sellByHalfBox && halfBoxPriceBs ? round2(CurrencyService.safeParse(halfBoxPriceBs)) : null;
    const finalHalfBoxBarcode = sellByHalfBox && halfBoxBarcode ? halfBoxBarcode.trim() : null;

    return {
        name: formattedName,
        barcode: barcode ? barcode.trim() : null,
        
        // Unidad
        priceUsd: finalPriceUsd,
        priceUsdt: finalPriceUsd, // Alias legacy
        priceBsManual: finalPriceBsManual,
        
        // Caja
        sellByBox: !!sellByBox,
        boxUnits: parsedBoxUnits,
        boxBarcode: finalBoxBarcode,
        boxPriceUsd: finalBoxPriceUsd,
        boxPriceBs: finalBoxPriceBs,

        // Media Caja
        sellByHalfBox: !!sellByHalfBox,
        halfBoxUnits: parsedHalfBoxUnits,
        halfBoxBarcode: finalHalfBoxBarcode,
        halfBoxPriceUsd: finalHalfBoxPriceUsd,
        halfBoxPriceBs: finalHalfBoxPriceBs,

        // Costo y Stock
        costUsd: finalCostUsd,
        costBs: finalCostBs,
        stock: stock ? parseInt(stock, 10) : 0,

        // Costo de compra por caja
        purchaseByBoxCost: purchaseByBoxCost ? round2(CurrencyService.safeParse(purchaseByBoxCost)) : null,
        purchaseBoxUnits: purchaseBoxUnits ? parseInt(purchaseBoxUnits, 10) : null,
        purchaseBoxBcv: purchaseBoxBcv ? true : false,
        forceBcv: forceBcv ? true : false,

        // Campos Legacy para evitar errores en otros componentes
        packagingType: 'suelto',
        unit: 'unidad',
        sellByUnit: false,
        unitPriceUsd: null,
        unitPriceCop: null,
        priceCop: null,
        category: category,
        lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : 5,
    };
}
