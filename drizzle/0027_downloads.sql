CREATE TABLE "download_entitlements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"provider" text NOT NULL,
	"order_id" text NOT NULL,
	"purchased_at" timestamp with time zone NOT NULL,
	"updates_until" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_releases" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"version" text NOT NULL,
	"object_key" text NOT NULL,
	"size" bigint NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "download_entitlements" ADD CONSTRAINT "download_entitlements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "download_entitlements_order_idx" ON "download_entitlements" USING btree ("provider","order_id","product_id");--> statement-breakpoint
CREATE INDEX "download_entitlements_user_idx" ON "download_entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "download_releases_product_version_idx" ON "download_releases" USING btree ("product_id","version");