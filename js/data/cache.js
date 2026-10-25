// In-memory cache backed by localStorage (best effort: storage may be
// unavailable or full, the app works without it).

const PREFIX = 'al2:';
const mem = new Map();

// drop entries written by older versions of the app
try {
  for (const k of Object.keys(localStorage)) if (/^al\d+:/.test(k) && !k.startsWith(PREFIX)) localStorage.removeItem(k);
} catch { /* ignore */ }

export const cached = {
  get(key) {
    if (mem.has(key)) return mem.get(key);
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw) {
        const v = JSON.parse(raw);
        mem.set(key, v);
        return v;
      }
    } catch { /* ignore */ }
    return undefined;
  },
  set(key, value, { persist = true } = {}) {
    mem.set(key, value);
    if (!persist) return;
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // quota exceeded: drop cached weather series (cheap to refetch, unlike
      // normals and species counts), retry once, else stay in memory only
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX + 'wx:')) localStorage.removeItem(k);
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
      } catch { /* ignore */ }
    }
  },
};

// Run `fn` over items with at most `limit` in flight. Keeps order.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
