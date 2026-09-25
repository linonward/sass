ALTER TABLE "ai_usage" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "prompt" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "file_id" text;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_kind_valid" CHECK ("ai_usage"."kind" in ('text', 'image', 'video'));