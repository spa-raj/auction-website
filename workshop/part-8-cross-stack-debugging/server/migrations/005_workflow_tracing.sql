-- Optional context never changes business eligibility, outcomes or payment authority.
ALTER TABLE auctions ADD COLUMN telemetry_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX auctions_telemetry_id ON auctions(telemetry_id);
ALTER TABLE bids ADD COLUMN trace_context jsonb;
ALTER TABLE auction_outcomes ADD COLUMN trace_context jsonb;
ALTER TABLE auction_outbox ADD COLUMN trace_context jsonb;
ALTER TABLE recipient_notifications ADD COLUMN trace_context jsonb;
ALTER TABLE purchases ADD COLUMN trace_context jsonb;
ALTER TABLE payment_events ADD COLUMN trace_context jsonb;
