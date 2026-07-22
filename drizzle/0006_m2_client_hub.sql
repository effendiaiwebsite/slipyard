CREATE TYPE "public"."client_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('individual', 'corporation', 'trust');--> statement-breakpoint
CREATE TYPE "public"."contact_channel" AS ENUM('phone', 'email', 'sms', 'meeting', 'mail', 'other');--> statement-breakpoint
CREATE TYPE "public"."engagement_status" AS ENUM('not_started', 'awaiting_docs', 'in_preparation', 'in_review', 'awaiting_signature', 'filed', 'noa_received');--> statement-breakpoint
CREATE TYPE "public"."engagement_type" AS ENUM('t1', 't2', 't3', 'other');--> statement-breakpoint
CREATE TYPE "public"."preferred_channel" AS ENUM('email', 'sms', 'phone', 'mail');--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "client_type" DEFAULT 'individual' NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"preferred_channel" "preferred_channel" DEFAULT 'phone' NOT NULL,
	"address_line1" text,
	"city" text,
	"province" text,
	"postal_code" text,
	"date_of_birth" date,
	"sin_encrypted" text,
	"sin_last3" text,
	"assigned_accountant_id" text,
	"household_id" uuid,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"channel" "contact_channel" NOT NULL,
	"summary" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" "engagement_type" DEFAULT 't1' NOT NULL,
	"tax_year" integer NOT NULL,
	"status" "engagement_status" DEFAULT 'not_started' NOT NULL,
	"status_timestamps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"assigned_to_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_assigned_accountant_id_staff_user_id_fk" FOREIGN KEY ("assigned_accountant_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_note" ADD CONSTRAINT "client_note_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_note" ADD CONSTRAINT "client_note_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_note" ADD CONSTRAINT "client_note_author_id_staff_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_assigned_to_id_staff_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household" ADD CONSTRAINT "household_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_org_name_idx" ON "client" USING btree ("org_id","display_name");--> statement-breakpoint
CREATE INDEX "client_org_assigned_idx" ON "client" USING btree ("org_id","assigned_accountant_id");--> statement-breakpoint
CREATE INDEX "client_org_household_idx" ON "client" USING btree ("org_id","household_id");--> statement-breakpoint
CREATE INDEX "client_note_org_client_idx" ON "client_note" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "contact_log_org_client_occurred_idx" ON "contact_log" USING btree ("org_id","client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "engagement_org_status_idx" ON "engagement" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "engagement_org_client_idx" ON "engagement" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "engagement_org_assigned_idx" ON "engagement" USING btree ("org_id","assigned_to_id");--> statement-breakpoint
CREATE INDEX "household_org_idx" ON "household" USING btree ("org_id");