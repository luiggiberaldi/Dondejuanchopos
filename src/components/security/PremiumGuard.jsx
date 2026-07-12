import React from 'react';

/**
 * PremiumGuard — Wrapper pasarela para Donde Juancho POS.
 * El sistema es permanente, por lo que este componente siempre permite el acceso a sus hijos.
 */
export default function PremiumGuard({ children }) {
    return <React.Fragment>{children}</React.Fragment>;
}
