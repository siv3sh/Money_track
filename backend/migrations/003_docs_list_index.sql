-- Speeds up the common transactions list: collection + user + received_at desc.
CREATE INDEX IF NOT EXISTS docs_collection_user_received_idx
  ON public.docs (collection, user_id, (doc->>'received_at') DESC);
