-- InvestWatch – schemat bazy (PostgreSQL 16)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Źródła monitorowane cyklicznie
CREATE TABLE sources (
  id            SERIAL PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  label         TEXT,
  kind          TEXT NOT NULL DEFAULT 'web',          -- web | social | sample
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Podmioty: firmy inwestycyjne, reklamujący, doradcy
CREATE TABLE entities (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  name_norm     TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'company',      -- company | person | influencer | unknown
  country       TEXT,
  domain        TEXT,
  registry_status TEXT NOT NULL DEFAULT 'unknown',    -- registered | not_found | unknown
  registry_ref  JSONB,
  krs           TEXT,
  nip           TEXT,
  lei           TEXT,
  enriched_at   TIMESTAMPTZ,                          -- ostatnie wzbogacenie (KRS/GLEIF/listy ostrzeżeń)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name_norm, kind)
);
CREATE INDEX entities_name_trgm ON entities USING gin (name_norm gin_trgm_ops);

-- Pobrane materiały
CREATE TABLE materials (
  id            SERIAL PRIMARY KEY,
  source_id     INT REFERENCES sources(id) ON DELETE SET NULL,
  url           TEXT NOT NULL,
  final_url     TEXT,
  title         TEXT,
  author        TEXT,
  published_at  TIMESTAMPTZ,
  lang          TEXT,
  platform      TEXT,                                 -- web | facebook | instagram | tiktok | youtube | x
  content_text  TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  raw           JSONB,                                -- pełny wynik scrapera (bloki, layout, metadane)
  status        TEXT NOT NULL DEFAULT 'NEW',          -- NEW | IN_REVIEW | REVIEWED | DISMISSED | ESCALATED
  ground_truth  BOOLEAN,                              -- etykieta testowa do kalibracji (TRUE = ryzykowny)
  simhash       TEXT,                                 -- odcisk treści do wykrywania prawie-duplikatów
  near_duplicate_of INT REFERENCES materials(id) ON DELETE SET NULL,
  layout_hash   TEXT,                                 -- odcisk wyglądu ostrzeżeń (zmiana CSS = nowa wersja)
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX materials_version_uq ON materials (url, content_hash, coalesce(layout_hash, ''));
CREATE INDEX materials_hash ON materials (content_hash);
CREATE INDEX materials_fetched ON materials (fetched_at DESC);
CREATE INDEX materials_text_trgm ON materials USING gin (content_text gin_trgm_ops);
CREATE INDEX materials_title_trgm ON materials USING gin (title gin_trgm_ops);

CREATE TABLE material_entities (
  material_id   INT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  entity_id     INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,                        -- advertised_firm | publisher | advisor
  PRIMARY KEY (material_id, entity_id, role)
);

-- Wynik analizy (historia: wiele analiz na materiał)
CREATE TABLE analyses (
  id            SERIAL PRIMARY KEY,
  material_id   INT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  score         NUMERIC(5,2) NOT NULL,                -- 0-100, niezależny od progu
  module_scores JSONB NOT NULL,                       -- {"m1":..,"m2":..,"m3":..}
  modules       TEXT[] NOT NULL,                      -- moduły, które coś wykryły
  result        JSONB NOT NULL,                       -- pełny zunifikowany obiekt z analizatora
  summary       TEXT,
  summary_engine TEXT,                                -- template | ollama:<model>
  analyzer_version TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analyses_material ON analyses (material_id, created_at DESC);

-- Przesłanki (do odtworzenia uzasadnienia)
CREATE TABLE findings (
  id            SERIAL PRIMARY KEY,
  analysis_id   INT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  module        TEXT NOT NULL,                        -- m1 | m2 | m3
  rule_id       TEXT NOT NULL,
  status        TEXT NOT NULL,                        -- fail | warn | pass | na | not_checked
  severity      INT NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  legal_basis   TEXT,
  explanation   TEXT,
  evidence      JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX findings_analysis ON findings (analysis_id);

CREATE TABLE alerts (
  id            SERIAL PRIMARY KEY,
  material_id   INT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  analysis_id   INT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  score         NUMERIC(5,2) NOT NULL,
  threshold     INT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'NEW',          -- NEW | REVIEWED | DISMISSED
  read          BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scan_jobs (
  id            SERIAL PRIMARY KEY,
  url           TEXT,
  source_id     INT REFERENCES sources(id) ON DELETE SET NULL,
  trigger       TEXT NOT NULL DEFAULT 'manual',       -- manual | schedule | seed | upload
  status        TEXT NOT NULL DEFAULT 'queued',       -- queued | running | done | duplicate | failed
  attempts      INT NOT NULL DEFAULT 0,
  error         TEXT,
  material_id   INT REFERENCES materials(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE TABLE settings (
  key           TEXT PRIMARY KEY,
  value         JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Wzbogacanie danych
CREATE TABLE registry_records (
  id            SERIAL PRIMARY KEY,
  entity_id     INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  registry      TEXT NOT NULL,                        -- knf | krs | gleif | esma | ...
  country       TEXT,
  status        TEXT NOT NULL,                        -- found | not_found | error
  data          JSONB,
  checked_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX registry_records_entity ON registry_records (entity_id, registry, checked_at DESC);

CREATE TABLE registry_snapshots (
  id            SERIAL PRIMARY KEY,
  registry      TEXT NOT NULL,
  payload_hash  TEXT NOT NULL,
  payload       JSONB NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  id            SERIAL PRIMARY KEY,
  full_name     TEXT NOT NULL,                        -- z KRS: zanonimizowane w publicznym API
  source        TEXT,
  masked        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE person_links (
  person_id     INT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  entity_id     INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  role          TEXT,
  source_url    TEXT,
  verification  TEXT NOT NULL DEFAULT 'wymaga weryfikacji',
  PRIMARY KEY (person_id, entity_id)
);

CREATE TABLE crisis_periods (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL
);

CREATE TABLE company_crisis_behavior (
  id            SERIAL PRIMARY KEY,
  entity_id     INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  crisis_id     INT NOT NULL REFERENCES crisis_periods(id) ON DELETE CASCADE,
  max_drawdown  NUMERIC,
  recovery_days INT,
  events        JSONB NOT NULL DEFAULT '[]',
  source_url    TEXT
);

CREATE TABLE reserves_reports (
  id            SERIAL PRIMARY KEY,
  entity_id     INT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  report_date   DATE,
  reserves      NUMERIC,
  liabilities   NUMERIC,
  coverage      NUMERIC,
  source_url    TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- próg ryzyka wstawia backend z DEFAULT_THRESHOLD przy pierwszym starcie
INSERT INTO settings (key, value) VALUES
  ('alert_modules', '["m1","m2","m3"]');

INSERT INTO crisis_periods (name, start_date, end_date) VALUES
  ('COVID-19 – krach marcowy', '2020-02-20', '2020-04-30'),
  ('Rynek kryptowalut 2022 (Terra/FTX)', '2022-05-01', '2022-12-31');
