CREATE TYPE "public"."signature_method" AS ENUM('drawn', 'typed');--> statement-breakpoint
CREATE TYPE "public"."signature_request_mode" AS ENUM('remote', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."signature_request_status" AS ENUM('draft', 'sent', 'viewed', 'signed', 'declined', 'canceled');--> statement-breakpoint
ALTER TYPE "public"."document_source" ADD VALUE 'esign_executed';--> statement-breakpoint
CREATE TABLE "signature_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"engagement_id" uuid,
	"title" text NOT NULL,
	"mode" "signature_request_mode" DEFAULT 'remote' NOT NULL,
	"status" "signature_request_status" DEFAULT 'draft' NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text,
	"signer_phone" text,
	"placements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_hash" text,
	"signed_document_id" uuid,
	"signed_hash" text,
	"signature_method" "signature_method",
	"signed_via" text,
	"signed_ip" text,
	"signed_token_id" uuid,
	"signed_by_staff_id" text,
	"decline_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_signed_document_id_document_id_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_signed_by_staff_id_staff_user_id_fk" FOREIGN KEY ("signed_by_staff_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_request" ADD CONSTRAINT "signature_request_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signature_request_org_client_idx" ON "signature_request" USING btree ("org_id","client_id");--> statement-breakpoint
CREATE INDEX "signature_request_org_status_idx" ON "signature_request" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "signature_request_org_engagement_idx" ON "signature_request" USING btree ("org_id","engagement_id");