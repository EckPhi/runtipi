CREATE TABLE "plugin" (
	"id" serial PRIMARY KEY NOT NULL,
	"urn" varchar NOT NULL,
	"plugin_id" varchar NOT NULL,
	"plugin_store_slug" varchar NOT NULL,
	"installed_version" varchar NOT NULL,
	"tipi_version" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"global_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" integer DEFAULT extract(epoch from now()) NOT NULL,
	"updated_at" integer DEFAULT extract(epoch from now()) NOT NULL,
	CONSTRAINT "plugin_urn_unique" UNIQUE("urn")
);
--> statement-breakpoint
ALTER TABLE "plugin" ADD CONSTRAINT "plugin_plugin_store_slug_app_store_slug_fk" FOREIGN KEY ("plugin_store_slug") REFERENCES "public"."app_store"("slug") ON DELETE no action ON UPDATE no action;