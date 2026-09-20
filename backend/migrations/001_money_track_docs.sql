-- Isolated Money Track store (migrated from MongoDB).
-- Applied on the connected Supabase project as money_track_docs_schema.

CREATE SCHEMA IF NOT EXISTS money_track;

CREATE TABLE IF NOT EXISTS money_track.docs (
  collection text NOT NULL,
  id text NOT NULL,
  doc jsonb NOT NULL,
  user_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

COMMENT ON TABLE money_track.docs IS
  'Document store for Money Track, migrated from MongoDB money_tracker.';

CREATE INDEX IF NOT EXISTS money_track_docs_user_idx
  ON money_track.docs (collection, user_id);

CREATE INDEX IF NOT EXISTS money_track_docs_received_idx
  ON money_track.docs (collection, (doc->>'received_at') DESC);

CREATE UNIQUE INDEX IF NOT EXISTS money_track_users_email_uq
  ON money_track.docs ((lower(doc->>'email')))
  WHERE collection = 'users';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_users_phone_uq
  ON money_track.docs ((doc->>'phone'))
  WHERE collection = 'users' AND COALESCE(doc->>'phone', '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_linked_webhook_uq
  ON money_track.docs ((doc->>'webhook_token'))
  WHERE collection = 'linked_accounts';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_linked_ident_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'kind'), (doc->>'identifier'))
  WHERE collection = 'linked_accounts';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_cc_bank_last4_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'bank'), (doc->>'last4'))
  WHERE collection = 'credit_cards';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_catmem_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'merchant_key'))
  WHERE collection = 'category_memory';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_sip_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'instrument'), (doc->>'month'))
  WHERE collection = 'sip_overrides';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_xfer_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'txn_id'))
  WHERE collection = 'transfer_suggestions';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_reports_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'month'))
  WHERE collection = 'monthly_reports';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_portfolio_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'instrument_key'))
  WHERE collection = 'portfolio' AND COALESCE(doc->>'instrument_key', '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_facts_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'fact_type'), (doc->>'key_norm'))
  WHERE collection = 'user_learned_facts';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_budgets_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'category'))
  WHERE collection = 'budgets';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_memories_dedupe_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'dedupe_key'))
  WHERE collection = 'advisor_memories' AND COALESCE(doc->>'dedupe_key', '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS money_track_chat_session_uq
  ON money_track.docs ((doc->>'user_id'), (doc->>'session_key'))
  WHERE collection = 'advisor_chat_sessions';

CREATE OR REPLACE FUNCTION money_track.sync_doc_meta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.user_id := NEW.doc->>'user_id';
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_doc_meta ON money_track.docs;
CREATE TRIGGER trg_sync_doc_meta
BEFORE INSERT OR UPDATE ON money_track.docs
FOR EACH ROW EXECUTE FUNCTION money_track.sync_doc_meta();

ALTER TABLE money_track.docs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA money_track FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA money_track TO postgres, service_role;
GRANT ALL ON TABLE money_track.docs TO postgres, service_role;
GRANT ALL ON FUNCTION money_track.sync_doc_meta() TO postgres, service_role;
