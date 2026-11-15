ALTER TABLE auction_outcomes ADD CONSTRAINT outcomes_purchase_reference
  UNIQUE (auction_slug, winner_id, winning_amount_cents);
CREATE TABLE purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_slug text NOT NULL UNIQUE REFERENCES auction_outcomes(auction_slug) ON DELETE CASCADE,
  winner_id integer NOT NULL REFERENCES demo_users(id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  session_id text UNIQUE,
  session_url text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  paid_at timestamptz,
  FOREIGN KEY (auction_slug, winner_id, amount_cents)
    REFERENCES auction_outcomes(auction_slug, winner_id, winning_amount_cents),
  CHECK ((session_id IS NULL) = (session_url IS NULL)),
  CHECK ((status = 'unpaid' AND paid_at IS NULL) OR (status = 'paid' AND paid_at IS NOT NULL AND session_id IS NOT NULL))
);
CREATE TABLE payment_events (
  event_id uuid PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  body_sha256 text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO purchases (auction_slug, winner_id, amount_cents)
  SELECT auction_slug, winner_id, winning_amount_cents FROM auction_outcomes WHERE status = 'sold';
