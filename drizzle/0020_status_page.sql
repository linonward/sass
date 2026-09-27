CREATE TABLE "status_checks" (
	"component" text PRIMARY KEY NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone NOT NULL,
	"last_ok" boolean,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component" text NOT NULL,
	"status" text NOT NULL,
	"message" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "status_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"locale" text,
	"confirm_hash" text,
	"confirm_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "status_events_component_idx" ON "status_events" USING btree ("component","created_at");--> statement-breakpoint
CREATE INDEX "status_events_open_idx" ON "status_events" USING btree ("component","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscribers_email_idx" ON "status_subscribers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "status_subscribers_confirm_hash_idx" ON "status_subscribers" USING btree ("confirm_hash");