import { useState, useCallback } from 'react';

/**
 * useDemoCountdown — Hook no-op para Donde Juancho POS.
 */
export function useDemoCountdown() {
    const [demoTimeLeft] = useState('');
    const [demoExpiredMsg] = useState('');
    const dismissExpiredMsg = useCallback(() => {}, []);

    return {
        demoTimeLeft,
        demoExpiredMsg,
        setDemoExpiredMsg: () => {},
        dismissExpiredMsg,
    };
}
