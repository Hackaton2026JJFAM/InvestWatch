// Wykluczenia w wyszukiwaniu kandydatów: słowa kluczowe spoza tematu (np. gry – „darmowa kasa w GTA5”),
// przy których wynik nie trafia do analizy ani do stałego monitoringu. Lista globalna (ustawienia) +
// dodatkowe słowa podane przy pojedynczym wyszukiwaniu.
import { one, q } from './db.js';

export const DEFAULT_EXCLUDE = ['gta', 'gta5', 'gtav', 'gtarp', 'fivem', 'roblox', 'robux', 'minecraft', 'fortnite', 'vbucks',
  'csgo', 'cs2', 'valorant', 'brawlstars', 'clashroyale', 'skrzynki', 'skiny', 'simulator', 'symulator'];

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

export function normalizeWords(words) {
  return [...new Set((words ?? []).map((w) => fold(w).replace(/^#+/, '').trim()).filter((w) => w.length >= 2 && w.length <= 40))].slice(0, 200);
}

export async function getExcludes() {
  const row = await one("SELECT value FROM settings WHERE key = 'exclude_keywords'");
  return Array.isArray(row?.value) ? row.value : DEFAULT_EXCLUDE;
}

export async function setExcludes(words) {
  const list = normalizeWords(words);
  await q(`INSERT INTO settings (key, value, updated_at) VALUES ('exclude_keywords', $1, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(list)]);
  return list;
}

/** Pierwsze słowo z listy obecne w tytule/autorze/opisie/tagach (całe słowo albo jego początek: gta5 ⊂ gta5rp). */
export function excludedBy(item, words) {
  if (!words?.length) return null;
  const text = fold([item.title, item.author, item.snippet, item.text, item.description, ...(item.tags ?? [])].filter(Boolean).join(' '));
  const tokens = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));
  for (const w of [...words].sort((a, b) => b.length - a.length)) {  // najdokładniejsze słowo (gta5 przed gta)
    if (w.includes(' ')) { if (text.includes(w)) return w; continue; }
    for (const t of tokens) if (t === w || (w.length >= 3 && t.startsWith(w))) return w;
  }
  return null;
}
