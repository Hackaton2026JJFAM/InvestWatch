// Zasięg i tagi materiału (wyświetlenia, polubienia, obserwujący, hashtagi) – do filtrowania,
// priorytetyzacji („ryzyko × zasięg”) i proaktywnego monitoringu popularnych treści.
const int = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : null);
export const normTag = (t) => String(t).toLowerCase().normalize('NFC').replace(/^#+/, '').trim();
const HASHTAG = /#([\p{L}\p{N}_]{2,40})/gu;

export function reachOf(material) {
  const meta = material.video_meta ?? material.layout?.video?.meta ?? {};
  const tags = new Set((meta.tags ?? []).filter((t) => typeof t === 'string').map(normTag)
    .filter((t) => t.length >= 2 && t.length <= 40 && /^[\p{L}\p{N}_]+$/u.test(t))); // tylko tagi w formie hashtagu (bez spacji)
  const text = `${material.title ?? ''}\n${material.description ?? ''}\n${(material.content_text ?? '').slice(0, 20000)}`;
  for (const m of text.matchAll(HASHTAG)) tags.add(normTag(m[1]));
  return {
    views: int(meta.view_count), likes: int(meta.like_count), followers: int(meta.channel_follower_count),
    tags: [...tags].slice(0, 40),
  };
}

// Polskie hashtagi finansowe i „przynęty” oszustów – punkt startu dla monitoringu, uzupełniany o tagi z bazy.
export const PRESET_TAGS = [
  'darmowakasa', 'pasywnydochod', 'dochodpasywny', 'zarabianie', 'zarabiajwinternecie', 'zarabianiewinternecie', 'szybkizarobek',
  'kasa', 'pieniadze', 'wolnoscfinansowa', 'inwestowanie', 'inwestycje', 'kryptowaluty', 'kryptopolska', 'bitcoinpolska', 'forex',
  'forexpolska', 'trading', 'tradingpolska', 'gielda', 'gpw', 'akcje', 'etf', 'finanseosobiste', 'oszczedzanie', 'biznesonline',
  'pracazdalna', 'dodatkowadochod', 'milioner', 'bogactwo',
];

// Frazy-przynęty typowe dla oszustw „inwestycyjnych” w polskim internecie (wyszukiwanie fraz, nie tylko tagów)
export const PL_SCAM_PHRASES = [
  'darmowa kasa', 'darmowe pieniądze', 'kasa za darmo', 'szybki zarobek', 'zarabiaj w domu', 'zarabiaj 1000 zł dziennie',
  'pasywny dochód bez wysiłku', 'gwarantowany zysk', 'inwestycja bez ryzyka', 'podwój swoje pieniądze', 'bot inwestycyjny zarabia',
  'zacznij od 250 zł', 'zarabiaj na kryptowalutach', 'sygnały tradingowe vip', 'odzyskaj utracone środki', 'inwestycja w akcje Orlenu',
  'polecaj i zarabiaj', 'zarobek na giełdzie bez wiedzy',
];
// Pakiety monitoringu: zestawy zapytań tworzone jednym kliknięciem (platformy wybiera analityk)
export const WATCH_PRESETS = {
  pl_scam: { label: 'Przynęty oszustów (frazy PL)', kind: 'search', items: PL_SCAM_PHRASES },
  pl_tags: { label: 'Hashtagi finansowe PL', kind: 'hashtag', items: PRESET_TAGS.slice(0, 16) },
};

export async function saveReach(t, materialId, material, result, watchId = null) {
  const r = reachOf(material);
  await t.q(
    `UPDATE materials SET views = $2, likes = $3, followers = $4, tags = $5, profile_type = $6, scam_score = $7,
            watch_id = COALESCE($8, watch_id), lang = COALESCE(lang, $9) WHERE id = $1`,
    [materialId, r.views, r.likes, r.followers, r.tags, result?.profile?.primary ?? null, result?.profile?.scam_score ?? null, watchId,
      result?.doc?.lang ?? null],
  );
  return r;
}
