ALTER TABLE "price_alerts" DROP CONSTRAINT "price_alerts_state_check";
--> statement-breakpoint
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_state_check" CHECK ("state" IN ('active','triggered','canceled','failed'));
