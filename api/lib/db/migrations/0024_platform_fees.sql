ALTER TABLE "executions" ADD COLUMN "platform_fee_bps" integer;
--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "platform_fee_amount_raw" text;
--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN "platform_fee_mint" text;
