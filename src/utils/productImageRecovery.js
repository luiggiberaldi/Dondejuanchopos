/**
 * Recuperación no destructiva de imágenes.
 * Solo completa `image` en productos que actualmente no tienen una imagen.
 * Ningún otro campo del producto se toma de la fuente de recuperación.
 */
export function isRecoverableImage(value) {
    return typeof value === 'string'
        && (value.startsWith('data:image/') || /^https?:\/\//i.test(value));
}

export function mergeMissingProductImages(currentProducts, ...sources) {
    if (!Array.isArray(currentProducts)) return { products: [], recovered: 0, recoveredIds: [] };

    const imagesById = new Map();
    for (const source of sources) {
        if (!Array.isArray(source)) continue;
        for (const product of source) {
            if (!product?.id || !isRecoverableImage(product.image) || imagesById.has(product.id)) continue;
            imagesById.set(product.id, product.image);
        }
    }

    const recoveredIds = [];
    const products = currentProducts.map(product => {
        if (!product?.id || isRecoverableImage(product.image)) return product;
        const image = imagesById.get(product.id);
        if (!image) return product;
        recoveredIds.push(product.id);
        return { ...product, image };
    });

    return { products, recovered: recoveredIds.length, recoveredIds };
}

export function mergeCloudProductImages(incomingProducts, localProducts) {
    if (!Array.isArray(incomingProducts)) return incomingProducts;
    const localById = new Map(
        (Array.isArray(localProducts) ? localProducts : [])
            .filter(product => product?.id && isRecoverableImage(product.image))
            .map(product => [product.id, product.image])
    );

    return incomingProducts.map(product => {
        if (!product?.id || Object.prototype.hasOwnProperty.call(product, 'image')) return product;
        const image = localById.get(product.id);
        return image ? { ...product, image } : product;
    });
}
