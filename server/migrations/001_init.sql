-- PromoApp Salon Suite – schema iniziale (multi-tenant)
-- Tutti i dati di business hanno tenant_id: nessuna query applicativa li legge senza filtro tenant.

CREATE TABLE tenants (
  id            SERIAL PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
  modules       JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_demo       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE domains (
  host       TEXT PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE locations (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT,
  phone      TEXT,
  is_main    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE staff (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id    INT REFERENCES locations(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  role_title     TEXT,
  bio            TEXT,
  specialties    TEXT,
  photo_url      TEXT,
  phone          TEXT,
  email          TEXT,
  color          TEXT NOT NULL DEFAULT '#b08968',
  schedule       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"1":[["09:00","13:00"],["14:00","18:00"]], ...} 0=domenica
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  online_bookable BOOLEAN NOT NULL DEFAULT true,
  show_on_site   BOOLEAN NOT NULL DEFAULT true,
  active         BOOLEAN NOT NULL DEFAULT true,
  sort           INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON staff(tenant_id);

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  tenant_id     INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  email         TEXT,
  display_name  TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','manager','operator','receptionist')),
  staff_id      INT REFERENCES staff(id) ON DELETE SET NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_tenant_username ON users(tenant_id, lower(username));

CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions(expires_at);

CREATE TABLE media (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  size       INT NOT NULL,
  data       BYTEA NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_categories (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  audience   TEXT NOT NULL CHECK (audience IN ('donna','uomo','bambino')),
  sort       INT NOT NULL DEFAULT 0
);

CREATE TABLE services (
  id                   SERIAL PRIMARY KEY,
  tenant_id            INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id          INT REFERENCES service_categories(id) ON DELETE SET NULL,
  audience             TEXT NOT NULL CHECK (audience IN ('donna','uomo','bambino')),
  name                 TEXT NOT NULL,
  description          TEXT,
  price_cents          INT NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  price_from           BOOLEAN NOT NULL DEFAULT false,
  duration_min         INT NOT NULL CHECK (duration_min BETWEEN 5 AND 600),
  processing_start_min INT NOT NULL DEFAULT 0,  -- dopo quanti minuti inizia la posa
  processing_min       INT NOT NULL DEFAULT 0,  -- minuti di posa: l'operatore è libero
  buffer_min           INT NOT NULL DEFAULT 0,  -- pausa/pulizia dopo il servizio
  online_bookable      BOOLEAN NOT NULL DEFAULT true,
  active               BOOLEAN NOT NULL DEFAULT true,
  sort                 INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (processing_start_min + processing_min <= duration_min)
);
CREATE INDEX ON services(tenant_id);

CREATE TABLE staff_services (
  staff_id   INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- Ferie, assenze, ritardi (staff_id valorizzato) o chiusure straordinarie del salone (staff_id NULL)
CREATE TABLE absences (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id   INT REFERENCES staff(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'ferie' CHECK (kind IN ('ferie','malattia','permesso','ritardo','chiusura','altro')),
  starts_at  TIMESTAMPTZ NOT NULL,
  ends_at    TIMESTAMPTZ NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON absences(tenant_id, starts_at);

CREATE TABLE customers (
  id                SERIAL PRIMARY KEY,
  tenant_id         INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name        TEXT NOT NULL,
  last_name         TEXT,
  phone             TEXT,
  phone_norm        TEXT,
  email             TEXT,
  birth_date        DATE,
  audience          TEXT CHECK (audience IN ('donna','uomo','bambino')),
  preferences       TEXT,
  notes             TEXT,
  consent_privacy   BOOLEAN NOT NULL DEFAULT false,
  consent_marketing BOOLEAN NOT NULL DEFAULT false,
  consent_photos    BOOLEAN NOT NULL DEFAULT false,
  consent_updated_at TIMESTAMPTZ,
  points            INT NOT NULL DEFAULT 0,
  last_visit_at     TIMESTAMPTZ,
  anonymized        BOOLEAN NOT NULL DEFAULT false,
  is_demo           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON customers(tenant_id, phone_norm);
CREATE INDEX ON customers(tenant_id, lower(email));

CREATE TABLE customer_notes (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'nota' CHECK (kind IN ('nota','formula','prodotti','tecnica')),
  body        TEXT NOT NULL,
  staff_id    INT REFERENCES staff(id) ON DELETE SET NULL,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_photos (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  media_id    INT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  label       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appointments (
  id              SERIAL PRIMARY KEY,
  tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id     INT REFERENCES locations(id) ON DELETE SET NULL,
  customer_id     INT REFERENCES customers(id) ON DELETE SET NULL,
  staff_id        INT NOT NULL REFERENCES staff(id),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'confermato'
                  CHECK (status IN ('in_attesa','confermato','arrivato','in_lavorazione','completato','cancellato','assente')),
  source          TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('online','staff')),
  customer_notes  TEXT,
  internal_notes  TEXT,
  total_cents     INT NOT NULL DEFAULT 0,
  manage_token    TEXT NOT NULL UNIQUE,
  recurrence_group TEXT,
  version         INT NOT NULL DEFAULT 1,
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  reminder_sent_at TIMESTAMPTZ,
  review_requested_at TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  is_demo         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON appointments(tenant_id, starts_at);
CREATE INDEX ON appointments(tenant_id, customer_id);

CREATE TABLE appointment_services (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id     INT REFERENCES services(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  price_cents    INT NOT NULL DEFAULT 0,
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  sort           INT NOT NULL DEFAULT 0
);
CREATE INDEX ON appointment_services(appointment_id);

-- Intervalli in cui l'operatore è effettivamente occupato (esclusi i tempi di posa).
-- Il vincolo di esclusione impedisce a livello di database qualsiasi sovrapposizione,
-- anche con conferme simultanee.
CREATE TABLE busy_blocks (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  staff_id       INT NOT NULL REFERENCES staff(id),
  during         TSTZRANGE NOT NULL
);
CREATE INDEX ON busy_blocks(tenant_id, staff_id);

CREATE TABLE waitlist (
  id           SERIAL PRIMARY KEY,
  tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  service_ids  INT[] NOT NULL DEFAULT '{}',
  staff_id     INT REFERENCES staff(id) ON DELETE SET NULL,
  date_from    DATE NOT NULL,
  date_to      DATE NOT NULL,
  notes        TEXT,
  status       TEXT NOT NULL DEFAULT 'attesa' CHECK (status IN ('attesa','avvisato','prenotato','chiuso')),
  notified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gallery (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  caption    TEXT,
  audience   TEXT,
  sort       INT NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE reviews (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  rating     INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body       TEXT NOT NULL,
  source     TEXT,
  approved   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE promotions (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('percent','fixed')),
  value       NUMERIC(10,2) NOT NULL CHECK (value >= 0),
  service_ids INT[] NOT NULL DEFAULT '{}',
  code        TEXT,
  starts_on   DATE,
  ends_on     DATE,
  birthday    BOOLEAN NOT NULL DEFAULT false,
  max_uses    INT,
  uses        INT NOT NULL DEFAULT 0,
  public      BOOLEAN NOT NULL DEFAULT true,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX promotions_code ON promotions(tenant_id, upper(code)) WHERE code IS NOT NULL;

CREATE TABLE packages (
  id            SERIAL PRIMARY KEY,
  tenant_id     INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  service_id    INT REFERENCES services(id) ON DELETE SET NULL,
  sessions      INT NOT NULL CHECK (sessions > 0),
  price_cents   INT NOT NULL CHECK (price_cents >= 0),
  validity_days INT,
  public        BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE customer_packages (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id    INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  package_id     INT REFERENCES packages(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  service_id     INT REFERENCES services(id) ON DELETE SET NULL,
  sessions_total INT NOT NULL,
  sessions_used  INT NOT NULL DEFAULT 0,
  expires_on     DATE,
  sale_id        INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (sessions_used <= sessions_total)
);

CREATE TABLE gift_cards (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  initial_cents  INT NOT NULL CHECK (initial_cents > 0),
  balance_cents  INT NOT NULL CHECK (balance_cents >= 0),
  customer_id    INT REFERENCES customers(id) ON DELETE SET NULL,
  recipient_name TEXT,
  message        TEXT,
  expires_on     DATE,
  status         TEXT NOT NULL DEFAULT 'attiva' CHECK (status IN ('attiva','esaurita','scaduta','annullata')),
  sale_id        INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_cards_code ON gift_cards(tenant_id, upper(code));

CREATE TABLE loyalty_ledger (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points      INT NOT NULL,
  reason      TEXT NOT NULL,
  sale_id     INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  notes      TEXT
);

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sku         TEXT,
  category    TEXT,
  brand       TEXT,
  supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
  cost_cents  INT NOT NULL DEFAULT 0,
  price_cents INT NOT NULL DEFAULT 0,
  stock       NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_stock   NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit        TEXT NOT NULL DEFAULT 'pz',
  retail      BOOLEAN NOT NULL DEFAULT true,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stock_movements (
  id          SERIAL PRIMARY KEY,
  tenant_id   INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty         NUMERIC(10,2) NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('carico','scarico','vendita','uso','rettifica','reso')),
  unit_cost_cents INT,
  note        TEXT,
  sale_id     INT,
  appointment_id INT,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cash_sessions (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  opened_by      INT REFERENCES users(id) ON DELETE SET NULL,
  opening_cents  INT NOT NULL DEFAULT 0,
  closed_at      TIMESTAMPTZ,
  closed_by      INT REFERENCES users(id) ON DELETE SET NULL,
  counted_cents  INT,
  expected_cents INT,
  notes          TEXT
);
CREATE UNIQUE INDEX one_open_cash_session ON cash_sessions(tenant_id) WHERE closed_at IS NULL;

CREATE TABLE sales (
  id              SERIAL PRIMARY KEY,
  tenant_id       INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id     INT REFERENCES customers(id) ON DELETE SET NULL,
  appointment_id  INT REFERENCES appointments(id) ON DELETE SET NULL,
  cash_session_id INT REFERENCES cash_sessions(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'aperta' CHECK (status IN ('aperta','chiusa','annullata')),
  discount_cents  INT NOT NULL DEFAULT 0,
  promotion_id    INT REFERENCES promotions(id) ON DELETE SET NULL,
  subtotal_cents  INT NOT NULL DEFAULT 0,
  total_cents     INT NOT NULL DEFAULT 0,
  points_earned   INT NOT NULL DEFAULT 0,
  points_redeemed INT NOT NULL DEFAULT 0,
  notes           TEXT,
  user_id         INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);
CREATE INDEX ON sales(tenant_id, closed_at);

CREATE TABLE sale_items (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id        INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('servizio','prodotto','pacchetto','giftcard')),
  ref_id         INT,
  name           TEXT NOT NULL,
  qty            NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_cents     INT NOT NULL,
  discount_cents INT NOT NULL DEFAULT 0,
  total_cents    INT NOT NULL,
  staff_id       INT REFERENCES staff(id) ON DELETE SET NULL,
  customer_package_id INT REFERENCES customer_packages(id) ON DELETE SET NULL
);

CREATE TABLE payments (
  id           SERIAL PRIMARY KEY,
  tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id      INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method       TEXT NOT NULL CHECK (method IN ('contanti','carta','bancomat','satispay','bonifico','giftcard','acconto','altro')),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  ref          TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id           SERIAL PRIMARY KEY,
  tenant_id    INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  spent_on     DATE NOT NULL DEFAULT CURRENT_DATE,
  category     TEXT NOT NULL DEFAULT 'altro',
  description  TEXT NOT NULL,
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  method       TEXT,
  supplier_id  INT REFERENCES suppliers(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_templates (
  id        SERIAL PRIMARY KEY,
  tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  channel   TEXT NOT NULL CHECK (channel IN ('email','whatsapp')),
  subject   TEXT,
  body      TEXT NOT NULL,
  wa_template TEXT,          -- nome template approvato su WhatsApp Business Platform
  active    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key, channel)
);

CREATE TABLE notification_log (
  id             SERIAL PRIMARY KEY,
  tenant_id      INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id    INT REFERENCES customers(id) ON DELETE SET NULL,
  appointment_id INT REFERENCES appointments(id) ON DELETE SET NULL,
  template_key   TEXT NOT NULL,
  channel        TEXT NOT NULL,
  to_addr        TEXT,
  subject        TEXT,
  body           TEXT,
  status         TEXT NOT NULL CHECK (status IN ('inviato','errore','non_configurato','senza_consenso','senza_recapito')),
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON notification_log(tenant_id, created_at);

CREATE TABLE audit_log (
  id         SERIAL PRIMARY KEY,
  tenant_id  INT REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  data       JSONB,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log(tenant_id, created_at);
