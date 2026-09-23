-- Dedicated Tally Supabase project: public.docs (exposed to the Data API).

CREATE TABLE IF NOT EXISTS public.docs (
  collection text NOT NULL,
  id text NOT NULL,
  doc jsonb NOT NULL,
  user_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, id)
);

CREATE INDEX IF NOT EXISTS docs_user_idx
  ON public.docs (collection, user_id);

CREATE INDEX IF NOT EXISTS docs_received_idx
  ON public.docs (collection, (doc->>'received_at') DESC);

CREATE UNIQUE INDEX IF NOT EXISTS docs_users_email_uq
  ON public.docs ((lower(doc->>'email')))
  WHERE collection = 'users';

CREATE UNIQUE INDEX IF NOT EXISTS docs_linked_webhook_uq
  ON public.docs ((doc->>'webhook_token'))
  WHERE collection = 'linked_accounts';

CREATE UNIQUE INDEX IF NOT EXISTS docs_linked_ident_uq
  ON public.docs ((doc->>'user_id'), (doc->>'kind'), (doc->>'identifier'))
  WHERE collection = 'linked_accounts';

CREATE UNIQUE INDEX IF NOT EXISTS docs_cc_bank_last4_uq
  ON public.docs ((doc->>'user_id'), (doc->>'bank'), (doc->>'last4'))
  WHERE collection = 'credit_cards';

CREATE UNIQUE INDEX IF NOT EXISTS docs_catmem_uq
  ON public.docs ((doc->>'user_id'), (doc->>'merchant_key'))
  WHERE collection = 'category_memory';

CREATE UNIQUE INDEX IF NOT EXISTS docs_sip_uq
  ON public.docs ((doc->>'user_id'), (doc->>'instrument'), (doc->>'month'))
  WHERE collection = 'sip_overrides';

CREATE UNIQUE INDEX IF NOT EXISTS docs_xfer_uq
  ON public.docs ((doc->>'user_id'), (doc->>'txn_id'))
  WHERE collection = 'transfer_suggestions';

CREATE UNIQUE INDEX IF NOT EXISTS docs_reports_uq
  ON public.docs ((doc->>'user_id'), (doc->>'month'))
  WHERE collection = 'monthly_reports';

CREATE UNIQUE INDEX IF NOT EXISTS docs_portfolio_uq
  ON public.docs ((doc->>'user_id'), (doc->>'instrument_key'))
  WHERE collection = 'portfolio' AND COALESCE(doc->>'instrument_key', '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS docs_facts_uq
  ON public.docs ((doc->>'user_id'), (doc->>'fact_type'), (doc->>'key_norm'))
  WHERE collection = 'user_learned_facts';

CREATE UNIQUE INDEX IF NOT EXISTS docs_budgets_uq
  ON public.docs ((doc->>'user_id'), (doc->>'category'))
  WHERE collection = 'budgets';

CREATE UNIQUE INDEX IF NOT EXISTS docs_memories_dedupe_uq
  ON public.docs ((doc->>'user_id'), (doc->>'dedupe_key'))
  WHERE collection = 'advisor_memories' AND COALESCE(doc->>'dedupe_key', '') <> '';

CREATE UNIQUE INDEX IF NOT EXISTS docs_chat_session_uq
  ON public.docs ((doc->>'user_id'), (doc->>'session_key'))
  WHERE collection = 'advisor_chat_sessions';

CREATE OR REPLACE FUNCTION public.sync_docs_meta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.user_id := NEW.doc->>'user_id';
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_docs_meta ON public.docs;
CREATE TRIGGER trg_sync_docs_meta
BEFORE INSERT OR UPDATE ON public.docs
FOR EACH ROW EXECUTE FUNCTION public.sync_docs_meta();

ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.docs FROM anon, authenticated;
GRANT ALL ON TABLE public.docs TO service_role;
NOTIFY pgrst, 'reload schema';
