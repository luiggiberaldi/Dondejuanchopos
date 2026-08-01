import { FROZEN_MODES, PRICING_MODES } from '../constants/pricingModes';

export function isFrozenMode(mode, bsManual, forceBcv, bsUsdRef) {
    if (FROZEN_MODES.includes(mode)) return true;
    if (PRICING_MODES.includes(mode) || forceBcv || Number(bsUsdRef) > 0) return false;
    return Number(bsManual) > 0;
}

export function getFrozenFormats(p) {
    if (!p) return [];
    const out = [];

    if (isFrozenMode(p.pricingMode, p.priceBsManual, p.forceBcv, p.priceBsUsdRef)) {
        out.push({
            type: 'unidad',
            currentBs: p.priceBsManual || 0,
            currentUsd: p.priceUsdt || p.priceUsd || 0
        });
    }

    if (p.sellByBox) {
        const boxMode = p.boxPricingMode === 'inherit' ? p.pricingMode : p.boxPricingMode;
        if (isFrozenMode(boxMode, p.boxPriceBsManual || p.boxPriceBs, p.forceBcv, p.boxPriceBsUsdRef)) {
            out.push({
                type: 'caja',
                currentBs: p.boxPriceBsManual || p.boxPriceBs || 0,
                currentUsd: p.boxPriceUsdt || p.boxPriceUsd || 0
            });
        }
    }

    if (p.sellByBox && p.sellByHalfBox) {
        const halfBoxMode = p.halfBoxPricingMode === 'inherit' ? p.pricingMode : p.halfBoxPricingMode;
        if (isFrozenMode(halfBoxMode, p.halfBoxPriceBsManual || p.halfBoxPriceBs, p.forceBcv, p.halfBoxPriceBsUsdRef)) {
            out.push({
                type: 'medioBulto',
                currentBs: p.halfBoxPriceBsManual || p.halfBoxPriceBs || 0,
                currentUsd: p.halfBoxPriceUsdt || p.halfBoxPriceUsd || 0
            });
        }
    }

    return out;
}
