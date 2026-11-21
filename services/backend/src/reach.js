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

// Popularne tagi finansowe (PL/EN) – punkt startu dla monitoringu, uzupełniany o tagi z bazy.
export const PRESET_TAGS = [
  'inwestowanie', 'kryptowaluty', 'bitcoin', 'forex', 'trading', 'gielda', 'pasywnydochod', 'zarabianie', 'finanseosobiste',
  'inwestycje', 'akcje', 'etf', 'daytrading', 'cfd', 'kryptowaluta', 'nft', 'altcoin', 'zarabiajwinternecie', 'wolnoscfinansowa',
  'crypto', 'investing', 'passiveincome', 'forextrader', 'makemoneyonline',
];

export async function saveReach(t, materialId, material, result, watchId = null) {
  const r = reachOf(material);
  await t.q(
    `UPDATE materials SET views = $2, likes = $3, followers = $4, tags = $5, profile_type = $6, scam_score = $7,
            watch_id = COALESCE($8, watch_id) WHERE id = $1`,
    [materialId, r.views, r.likes, r.followers, r.tags, result?.profile?.primary ?? null, result?.profile?.scam_score ?? null, watchId],
  );
  return r;
}
