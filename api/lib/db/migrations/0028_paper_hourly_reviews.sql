-- Existing benchmark slots were measured in days from the common funding time.
UPDATE paper_ai_screens SET epoch = epoch * 24 WHERE epoch IN (1, 2);
--> statement-breakpoint
UPDATE paper_ai_accounts a SET
  epoch = CASE WHEN epoch < 0 THEN epoch ELSE epoch * 24 END,
  revision = revision + 1,
  next_at = CASE WHEN epoch IN (0, 1)
    THEN LEAST(next_at, started_at + (epoch * 24 + 1) * interval '1 hour')
    ELSE next_at END,
  rounds = COALESCE((
    SELECT jsonb_agg(r || jsonb_build_object(
      'epoch', (r->>'epoch')::int * 24, 'method', 'daily-v1'
    ) ORDER BY ord)
    FROM jsonb_array_elements(a.rounds) WITH ORDINALITY AS j(r, ord)
  ), '[]'::jsonb);
