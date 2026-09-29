CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "billing_exceptions_kind_valid" CHECK ("billing_exceptions"."kind" in ('refund_reclaim_shortfall', 'ai_job_needs_review')),
	CONSTRAINT "billing_exceptions_status_valid" CHECK ("billing_exceptions"."status" in ('open', 'resolved', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "billing_exceptions" ADD CONSTRAINT "billing_exceptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_actions_target_idx" ON "admin_actions" USING btree ("target_kind","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_exceptions_source_unique" ON "billing_exceptions" USING btree ("kind","source","source_id");--> statement-breakpoint
CREATE INDEX "billing_exceptions_status_created_idx" ON "billing_exceptions" USING btree ("status","created_at");