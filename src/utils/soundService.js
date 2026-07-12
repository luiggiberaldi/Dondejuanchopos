// Servicio global de sonido profesional offline (sintetizado mediante Web Audio API)
// Todos los sonidos se desactivan si dj_sound_enabled en localStorage es 'false'

let sharedAudioContext = null;

const isSoundEnabled = () => {
    return localStorage.getItem('dj_sound_enabled') !== 'false';
};

const getAudioContext = () => {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    
    if (!sharedAudioContext) {
        sharedAudioContext = new AudioContextClass();
    }
    
    // Si está suspendido, intentar reanudarlo
    if (sharedAudioContext.state === 'suspended') {
        sharedAudioContext.resume().catch(() => {});
    }
    
    return sharedAudioContext;
};

// Desbloquear AudioContext al primer toque de pantalla por política de autoplay
if (typeof window !== 'undefined') {
    const unlockAudio = () => {
        const ctx = getAudioContext();
        if (ctx) {
            ctx.resume().then(() => {
                // Remover listeners tras desbloqueo
                window.removeEventListener('click', unlockAudio);
                window.removeEventListener('pointerdown', unlockAudio);
                window.removeEventListener('keydown', unlockAudio);
                console.log('[SoundService] AudioContext desbloqueado con éxito.');
            }).catch(() => {});
        }
    };
    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
}

export const soundService = {
    // 1. Sonido de éxito (Cobro exitoso, arpegio ascendente elegante)
    playSuccess() {
        if (!isSoundEnabled()) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const notes = [523.25, 659.25, 783.99, 1046.50]; // Do5, Mi5, Sol5, Do6
            notes.forEach((freq, index) => {
                const time = ctx.currentTime + (index * 0.08);
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, time);
                
                gain.gain.setValueAtTime(0.4, time);
                gain.gain.exponentialRampToValueAtTime(0.01, time + 0.35);
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.start(time);
                osc.stop(time + 0.35);
            });
        } catch (e) {
            console.warn('[SoundService] Error al reproducir éxito:', e);
        }
    },

    // 2. Sonido de error (Transacción fallida, tono grave doble "buzz")
    playError() {
        if (!isSoundEnabled()) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'sawtooth'; // Onda diente de sierra para un tono de alerta áspero pero controlado
            osc.frequency.setValueAtTime(120, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.25);
            
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.25);

            // Segundo buzz rápido
            setTimeout(() => {
                if (ctx.state === 'closed') return;
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.type = 'sawtooth';
                osc2.frequency.setValueAtTime(100, ctx.currentTime);
                gain2.gain.setValueAtTime(0.3, ctx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.start();
                osc2.stop(ctx.currentTime + 0.3);
            }, 100);
        } catch (e) {
            console.warn('[SoundService] Error al reproducir error:', e);
        }
    },

    // 3. Sonido de agregar al carrito (Click digital sutil y rápido)
    playCartAdd() {
        if (!isSoundEnabled()) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1200, ctx.currentTime);
            
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.05);
        } catch (e) {
            console.warn('[SoundService] Error al reproducir click de carrito:', e);
        }
    },

    // 4. Sonido de alerta (Campana de cambio de tasa del supervisor)
    playAlert() {
        if (!isSoundEnabled()) return;
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const osc1 = ctx.createOscillator();
            const gain1 = ctx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(987.77, ctx.currentTime); // Si5
            osc1.frequency.exponentialRampToValueAtTime(1318.51, ctx.currentTime + 0.12);
            
            gain1.gain.setValueAtTime(0.8, ctx.currentTime);
            gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            
            osc1.connect(gain1);
            gain1.connect(ctx.destination);
            
            osc1.start();
            osc1.stop(ctx.currentTime + 0.4);

            setTimeout(() => {
                if (ctx.state === 'closed') return;
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(1318.51, ctx.currentTime); // Mi6
                osc2.frequency.exponentialRampToValueAtTime(1567.98, ctx.currentTime + 0.15);
                
                gain2.gain.setValueAtTime(0.8, ctx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
                
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                
                osc2.start();
                osc2.stop(ctx.currentTime + 0.5);
            }, 120);
        } catch (e) {
            console.warn('[SoundService] Error al reproducir alerta:', e);
        }
    }
};
