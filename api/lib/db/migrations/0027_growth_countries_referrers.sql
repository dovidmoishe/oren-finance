-- Country per pageview, resolved from the request address at collection time.
-- The address itself is never stored. Rows collected before this have no country.
ALTER TABLE growth_pageviews
  ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');
--> statement-breakpoint
-- Daily visits by country and by the referring site that started the visit.
ALTER TABLE growth_daily_metrics DROP CONSTRAINT growth_daily_metrics_grain_check;
--> statement-breakpoint
ALTER TABLE growth_daily_metrics ADD CONSTRAINT growth_daily_metrics_grain_check
  CHECK (grain IN ('site', 'path', 'campaign', 'country', 'referrer'));
