CREATE TYPE "public"."checklist_item_status" AS ENUM('missing', 'received', 'waived');--> statement-breakpoint
CREATE TYPE "public"."document_source" AS ENUM('staff_upload', 'portal_upload');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending_scan', 'clean', 'infected', 'scan_failed');--> statement-breakpoint
CREATE TABLE "checklist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"engagement_id" uuid NOT NULL,
	"title" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" "checklist_item_status" DEFAULT 'missing' NOT NULL,
	"document_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"engagement_id" uuid,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"s3_key" text NOT NULL,
	"status" "document_status" DEFAULT 'pending_scan' NOT NULL,
	"scan_result" text,
	"scanned_at" timestamp with time zone,
	"source" "document_source" DEFAULT 'staff_upload' NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_item" ADD CONSTRAINT "checklist_item_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_staff_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_item_org_engagement_idx" ON "checklist_item" USING btree ("org_id","engagement_id");--> statement-breakpoint
CREATE INDEX "checklist_item_org_document_idx" ON "checklist_item" USING btree ("org_id","document_id");--> statement-breakpoint
CREATE INDEX "document_org_client_idx" ON "document" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "document_org_engagement_idx" ON "document" USING btree ("org_id","engagement_id");--> statement-breakpoint
CREATE INDEX "document_org_status_idx" ON "document" USING btree ("org_id","status");