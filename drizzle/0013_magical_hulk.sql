CREATE TABLE "acquisition_leads" (
	"id" text PRIMARY KEY NOT NULL,
	"list_id" text NOT NULL,
	"email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"consent_text" text,
	"consent_version" text,
	"consent_at" timestamp with time zone,
	"snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"confirm_hash" text,
	"confirm_expires_at" timestamp with time zone,
	"withdraw_hash" text,
	"sent_at" timestamp with time zone,
	"user_id" text,
	"linked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "lead_id" text;--> statement-breakpoint
ALTER TABLE "acquisition_leads" ADD CONSTRAINT "acquisition_leads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_list_email_idx" ON "acquisition_leads" USING btree ("list_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_confirm_hash_idx" ON "acquisition_leads" USING btree ("confirm_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_withdraw_hash_idx" ON "acquisition_leads" USING btree ("withdraw_hash");--> statement-breakpoint
CREATE INDEX "leads_expiry_idx" ON "acquisition_leads" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "acquisition_leads" USING btree ("email");--> statement-breakpoint
ALTER TABLE "user_attribution" ADD CONSTRAINT "user_attribution_lead_id_acquisition_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."acquisition_leads"("id") ON DELETE set null ON UPDATE no action;