CREATE TABLE "referral_reward_debt" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"reward_id" text,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referral_rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"invitee_user_id" text NOT NULL,
	"inviter_user_id" text NOT NULL,
	"order_ref" text NOT NULL,
	"type" text NOT NULL,
	"inviter_credits" integer DEFAULT 0 NOT NULL,
	"invitee_credits" integer DEFAULT 0 NOT NULL,
	"inviter_grant_source_id" text,
	"invitee_grant_source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_relationships" ADD COLUMN "rule_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "referral_reward_debt" ADD CONSTRAINT "referral_reward_debt_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_invitee_user_id_user_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_rewards" ADD CONSTRAINT "referral_rewards_inviter_user_id_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "referral_reward_debt_user_idx" ON "referral_reward_debt" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referral_reward_debt_settled_idx" ON "referral_reward_debt" USING btree ("settled_at");--> statement-breakpoint
CREATE INDEX "referral_rewards_invitee_idx" ON "referral_rewards" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_inviter_idx" ON "referral_rewards" USING btree ("inviter_user_id");--> statement-breakpoint
CREATE INDEX "referral_rewards_order_idx" ON "referral_rewards" USING btree ("order_ref");