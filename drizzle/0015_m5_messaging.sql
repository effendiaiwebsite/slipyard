CREATE TYPE "public"."message_kind" AS ENUM('manual', 'mass', 'reminder');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"engagement_id" uuid,
	"template_id" uuid,
	"batch_id" uuid,
	"kind" "message_kind" NOT NULL,
	"channel" "outbox_channel" NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"outbox_id" uuid,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"channel" "outbox_channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "sms_opt_out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_template_id_message_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_outbox_id_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."outbox"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_org_client_created_idx" ON "message" USING btree ("org_id","client_id","created_at");--> statement-breakpoint
CREATE INDEX "message_org_batch_idx" ON "message" USING btree ("org_id","batch_id");--> statement-breakpoint
CREATE INDEX "message_org_engagement_kind_idx" ON "message" USING btree ("org_id","engagement_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_org_name_uq" ON "message_template" USING btree ("org_id","name");