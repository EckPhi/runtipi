CREATE TABLE "app_backup_status" (
	"app_id" integer PRIMARY KEY NOT NULL,
	"last_success_at" integer,
	"last_error_at" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "app_storage_sample" (
	"app_id" integer NOT NULL,
	"sampled_at" integer NOT NULL,
	"bytes" bigint NOT NULL,
	CONSTRAINT "app_storage_sample_app_id_sampled_at_pk" PRIMARY KEY("app_id","sampled_at")
);
--> statement-breakpoint
CREATE TABLE "user_dashboard_preference" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"hidden_widgets" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_backup_status" ADD CONSTRAINT "app_backup_status_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_storage_sample" ADD CONSTRAINT "app_storage_sample_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_dashboard_preference" ADD CONSTRAINT "user_dashboard_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_storage_sample_sampled_at_idx" ON "app_storage_sample" USING btree ("sampled_at");