CREATE TABLE "notification_log" (
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"last_sent_at" timestamp NOT NULL,
	CONSTRAINT "notification_log_kind_key_pk" PRIMARY KEY("kind","key")
);
--> statement-breakpoint
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;