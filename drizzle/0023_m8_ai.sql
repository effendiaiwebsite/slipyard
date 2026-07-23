CREATE TYPE "public"."ai_feature" AS ENUM('assistant', 'email_draft', 'meeting_prep', 'audit_risk', 'optimize');--> statement-breakpoint
CREATE TABLE "ai_interaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"feature" "ai_feature" NOT NULL,
	"prompt" text NOT NULL,
	"response" text NOT NULL,
	"tools_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_interaction" ADD CONSTRAINT "ai_interaction_user_id_staff_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_interaction_org_created_idx" ON "ai_interaction" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_interaction_org_user_idx" ON "ai_interaction" USING btree ("org_id","user_id");