import { useCallback } from 'react';
import { soundService } from '../utils/soundService';

export function useSounds() {
    const playAdd = useCallback(() => {
        soundService.playCartAdd();
    }, []);

    const playRemove = useCallback(() => {
        try {
            // Un tono descendente sutil
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08);
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start();
                osc.stop(ctx.currentTime + 0.08);
            }
        } catch (e) {}
    }, []);

    const playCheckout = useCallback(() => {
        soundService.playSuccess();
    }, []);

    const playError = useCallback(() => {
        soundService.playError();
    }, []);

    const playSuccess = useCallback(() => {
        soundService.playSuccess();
    }, []);

    const playTap = useCallback(() => {
        soundService.playCartAdd();
    }, []);

    return { playAdd, playRemove, playCheckout, playError, playSuccess, playTap };
}
