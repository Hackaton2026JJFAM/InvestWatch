// Oznaczenie podmiotu w zakładce „Podmioty”: kategoria (spółka / podmiot doradczy) i potwierdzenie.
// Wartości automatyczne liczone w SQL; ręczna decyzja analityka (category_manual, verified_manual) ma pierwszeństwo.
//  - spółka: podmiot typu „company” bez roli doradczej z Modułu 3; potwierdzona automatycznie, gdy ma numer KRS
//    polskiej spółki (KRS to rejestr polski – numer przy firmie zagranicznej albo „braku w rejestrze” to zwykle
//    błędne dopasowanie po nazwie przy wzbogacaniu),
//  - podmiot doradczy: finfluencerzy, autorzy, podmioty z ofertą doradczą – potwierdzane tylko ręcznie.

export const CATEGORIES = ['spolka', 'doradca'];

export const categorySql = (e = 'e') => `COALESCE(${e}.category_manual, CASE WHEN ${e}.kind = 'company'
  AND NOT EXISTS (SELECT 1 FROM material_entities x WHERE x.entity_id = ${e}.id AND x.role = 'advisor') THEN 'spolka' ELSE 'doradca' END)`;

const autoVerifiedSql = (e = 'e') => `(${categorySql(e)} = 'spolka' AND ${e}.krs IS NOT NULL
  AND (lower(coalesce(${e}.country, '')) IN ('pl', 'polska') OR (${e}.country IS NULL AND ${e}.registry_status <> 'not_found')))`;

export const verifiedSql = (e = 'e') => `COALESCE(${e}.verified_manual, ${autoVerifiedSql(e)})`;

// skąd potwierdzenie: „manual” (analityk), „krs” (automatycznie z numeru KRS) albo null
export const verifiedSourceSql = (e = 'e') => `CASE WHEN ${e}.verified_manual IS NOT NULL THEN 'manual'
  WHEN ${autoVerifiedSql(e)} THEN 'krs' END`;

export const statusColumns = (e = 'e') =>
  `${categorySql(e)} AS category, ${verifiedSql(e)} AS verified, ${verifiedSourceSql(e)} AS verified_source, ${e}.verified_at`;
