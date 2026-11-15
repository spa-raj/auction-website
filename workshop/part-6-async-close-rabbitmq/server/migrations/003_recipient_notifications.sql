CREATE TABLE recipient_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES auction_outbox(event_id) ON DELETE CASCADE,
  recipient_id integer NOT NULL REFERENCES demo_users(id),
  role text NOT NULL CHECK (role IN ('seller', 'winner')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dismissed_at timestamptz,
  UNIQUE (event_id, recipient_id)
);
CREATE INDEX recipient_notifications_pending ON recipient_notifications(recipient_id, created_at, id)
  WHERE dismissed_at IS NULL;
