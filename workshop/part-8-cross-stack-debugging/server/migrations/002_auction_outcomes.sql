-- Composite reference ensures the recorded winner and amount belong to this bid/auction.
ALTER TABLE bids ADD CONSTRAINT bids_outcome_reference UNIQUE (id, auction_slug, bidder_id, amount_cents);
CREATE TABLE auction_outcomes (
  auction_slug text PRIMARY KEY REFERENCES auctions(slug) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('sold', 'no_bids')),
  winning_bid_id integer,
  winner_id integer REFERENCES demo_users(id),
  winning_amount_cents integer,
  closes_at timestamptz NOT NULL,
  finalized_at timestamptz NOT NULL,
  CHECK (finalized_at >= closes_at),
  CHECK ((status = 'sold' AND winning_bid_id IS NOT NULL AND winner_id IS NOT NULL AND winning_amount_cents IS NOT NULL AND winning_amount_cents > 0)
    OR (status = 'no_bids' AND winning_bid_id IS NULL AND winner_id IS NULL AND winning_amount_cents IS NULL)),
  FOREIGN KEY (winning_bid_id, auction_slug, winner_id, winning_amount_cents)
    REFERENCES bids(id, auction_slug, bidder_id, amount_cents)
);
CREATE TABLE auction_outbox (
  event_id uuid PRIMARY KEY,
  auction_slug text NOT NULL UNIQUE REFERENCES auction_outcomes(auction_slug) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type = 'auction.closed'),
  event_version integer NOT NULL CHECK (event_version = 1),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  published_at timestamptz
);
CREATE INDEX auctions_due_close ON auctions(closes_at, slug);
CREATE INDEX auction_outbox_pending ON auction_outbox(created_at, event_id) WHERE published_at IS NULL;
