// Genera public/intercom-badge.png: silueta monocroma (blanco sobre transparente)
// para el icono pequeño de las notificaciones en Android, que sólo usa el canal alfa.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SIZE = 96;
const SS = 4; // supersampling para bordes suaves

function inRoundRect(x, y, x0, y0, x1, y1, r) {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
    const s = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
    const t = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    if ((s < 0) !== (t < 0) && s !== 0 && t !== 0) return false;
    const d = (cx - bx) * (py - by) - (cy - by) * (px - bx);
    return d === 0 || (d < 0) === (s + t <= 0);
}
function inside(x, y) {
    const bubble = inRoundRect(x, y, 10, 14, 86, 68, 16)
        || inTriangle(x, y, [22, 60], [42, 60], [18, 84]);
    if (!bubble) return false;
    const dots = [30, 48, 66].some(cx => (x - cx) ** 2 + (y - 41) ** 2 <= 6.5 ** 2);
    return !dots;
}

const png = new PNG({ width: SIZE, height: SIZE });
for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
            if (inside(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
        }
        const i = (y * SIZE + x) * 4;
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
        png.data[i + 3] = Math.round((hits / (SS * SS)) * 255);
    }
}
const out = path.join(__dirname, '..', 'public', 'intercom-badge.png');
fs.writeFileSync(out, PNG.sync.write(png));
console.log('written', out);
