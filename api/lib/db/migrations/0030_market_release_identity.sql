-- Keep UUIDs (and reminder foreign keys) when the agency changes the date.
-- Older schedules may retain a cancelled copy alongside the current release.
WITH identities AS (
  SELECT id, source, date_status, updated_at,
         concat_ws(':', kind, 'period', raw->>'referencePeriod', raw->>'estimate') AS stable_key
  FROM market_events
  WHERE family = 'macro' AND kind <> 'fomc_decision' AND raw->>'referencePeriod' IS NOT NULL
), ranked AS (
  SELECT id, stable_key, row_number() OVER (
    PARTITION BY source, stable_key
    ORDER BY (date_status <> 'cancelled') DESC, (date_status = 'released') DESC, updated_at DESC, id
  ) AS position
  FROM identities
)
UPDATE market_events e SET source_event_id = ranked.stable_key
FROM ranked WHERE e.id = ranked.id AND ranked.position = 1;
--> statement-breakpoint
-- A previously stored GDP revision with a known older table date must be
-- eligible for another refresh. A superseded release will correctly stay blank.
UPDATE market_events SET date_status = 'scheduled', actual = NULL, previous = NULL,
  unit = NULL, raw = raw - 'result', updated_at = now()
WHERE source = 'bea' AND kind = 'gdp' AND date_status = 'released'
  AND raw->>'estimate' IN ('second', 'third')
  AND raw #>> '{result,lastRevised}' < raw->>'dateEt';
