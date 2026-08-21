import React from 'react';
import ReportsArticleTab from '../Reports/ReportsArticleTab';

/**
 * Pestaña "Reportes por Artículo" del Monitor de Supervisión.
 */
export default function MonitorArticlesTab({
    salesForStats,
    products,
    bcvRate,
    triggerHaptic,
    from,
    to,
    artRange,
    setArtRange,
    setArtFrom,
    setArtTo,
}) {
    return (
        <ReportsArticleTab
            salesForStats={salesForStats}
            products={products}
            bcvRate={bcvRate}
            triggerHaptic={triggerHaptic}
            from={from}
            to={to}
            artRange={artRange}
            setArtRange={setArtRange}
            setArtFrom={setArtFrom}
            setArtTo={setArtTo}
        />
    );
}
