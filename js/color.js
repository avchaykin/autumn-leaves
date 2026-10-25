// Colour mixing in linear RGB so blends of green and orange don't go muddy.

const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const toSrgb = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const out = [16, 8, 0].map((s) => {
    const ca = toLin((pa >> s) & 255), cb = toLin((pb >> s) & 255);
    return Math.round(Math.max(0, Math.min(255, toSrgb(ca + (cb - ca) * t))));
  });
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
}
