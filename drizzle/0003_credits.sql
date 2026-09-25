CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credit_transactions_source_unique" UNIQUE("source","source_id"),
	CONSTRAINT "credit_transactions_type_valid" CHECK ("credit_transactions"."type" in ('grant', 'deduct', 'refund', 'adjust')),
	CONSTRAINT "credit_transactions_amount_non_zero" CHECK ("credit_transactions"."amount" <> 0),
	CONSTRAINT "credit_transactions_amount_sign" CHECK (("credit_transactions"."type" in ('grant', 'refund') and "credit_transactions"."amount" > 0)
        or ("credit_transactions"."type" = 'deduct' and "credit_transactions"."amount" < 0)
        or "credit_transactions"."type" = 'adjust')
);
--> statement-breakpoint
CREATE TABLE "user_credits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_credits_balance_non_negative" CHECK ("user_credits"."balance" >= 0)
);
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_transactions_user_created_idx" ON "credit_transactions" USING btree ("user_id","created_at");