CREATE TABLE "user_preferences" (
  "user_id" text PRIMARY KEY NOT NULL,
  "sectors" text[] NOT NULL,
  "morning_brief" boolean NOT NULL,
  "breaking_news" boolean NOT NULL,
  "brief_time" text NOT NULL,
  "time_zone" text NOT NULL
);
