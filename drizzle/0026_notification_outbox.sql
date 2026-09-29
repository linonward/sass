CREATE TABLE "pending_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"user_id" text,
	"to" text NOT NULL,
	"template" text NOT NULL,
	"props" jsonb NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"claimed_at" timestamp,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_notifications_status_valid" CHECK ("pending_notifications"."status" in ('pending', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "billing_exceptions" DROP CONSTRAINT "billing_exceptions_kind_valid";--> statement-breakpoint
ALTER TABLE "pending_notifications" ADD CONSTRAINT "pending_notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_notifications_due_idx" ON "pending_notifications" USING btree ("next_retry_at") WHERE "pending_notifications"."status" in ('pending', 'sending');--> statement-breakpoint
CREATE INDEX "pending_notifications_kind_key_idx" ON "pending_notifications" USING btree ("kind","key");--> statement-breakpoint
ALTER TABLE "billing_exceptions" ADD CONSTRAINT "billing_exceptions_kind_valid" CHECK ("billing_exceptions"."kind" in ('refund_reclaim_shortfall', 'ai_job_needs_review', 'notification_failed'));