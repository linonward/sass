CREATE TABLE "job_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"locked_until" timestamp with time zone NOT NULL,
	"last_started_at" timestamp with time zone NOT NULL,
	"last_finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "recovery_checked_at" timestamp;--> statement-breakpoint
CREATE INDEX "ai_usage_pending_idx" ON "ai_usage" USING btree ("recovery_checked_at","created_at") WHERE "ai_usage"."status" = 'pending';