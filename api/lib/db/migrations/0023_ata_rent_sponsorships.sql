-- Generated with drizzle-kit from the pre-feature and current schemas.
CREATE TABLE "ata_rent_sponsorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"wallet" text NOT NULL,
	"mint" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"lamports" numeric(20, 0) NOT NULL,
	"signature" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sponsored_at" timestamp with time zone
);

--> statement-breakpoint
CREATE UNIQUE INDEX "ata_rent_wallet_mint_unique" ON "ata_rent_sponsorships" USING btree ("wallet","mint");
--> statement-breakpoint
CREATE INDEX "ata_rent_user_idx" ON "ata_rent_sponsorships" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "ata_rent_created_idx" ON "ata_rent_sponsorships" USING btree ("created_at");
