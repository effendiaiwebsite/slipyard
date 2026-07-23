CREATE TYPE "public"."import_kind" AS ENUM('clients');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('create', 'skip');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('staged', 'committed', 'rolled_back', 'partially_rolled_back');--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "import_kind" DEFAULT 'clients' NOT NULL,
	"status" "import_status" DEFAULT 'staged' NOT NULL,
	"filename" text NOT NULL,
	"source_columns" text[] DEFAULT '{}' NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"committed_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_mapping_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "import_kind" DEFAULT 'clients' NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_staging_row" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" text[] DEFAULT '{}' NOT NULL,
	"action" "import_row_action" DEFAULT 'create' NOT NULL,
	"created_client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping_template" ADD CONSTRAINT "import_mapping_template_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mapping_template" ADD CONSTRAINT "import_mapping_template_created_by_staff_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_row" ADD CONSTRAINT "import_staging_row_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_row" ADD CONSTRAINT "import_staging_row_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_row" ADD CONSTRAINT "import_staging_row_created_client_id_client_id_fk" FOREIGN KEY ("created_client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batch_org_created_idx" ON "import_batch" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_mapping_template_org_name_uq" ON "import_mapping_template" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "import_staging_row_org_batch_idx" ON "import_staging_row" USING btree ("org_id","batch_id","row_number");