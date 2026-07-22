CREATE TYPE "public"."stage_category" AS ENUM('not_started', 'awaiting_docs', 'in_progress', 'awaiting_signature', 'filed', 'complete');--> statement-breakpoint
CREATE TABLE "engagement_stage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"category" "stage_category" NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "engagement" ADD COLUMN "stage_id" uuid;--> statement-breakpoint
ALTER TABLE "engagement_stage" ADD CONSTRAINT "engagement_stage_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_stage_org_key_uq" ON "engagement_stage" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "engagement_stage_org_position_idx" ON "engagement_stage" USING btree ("org_id","position");--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_stage_id_engagement_stage_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."engagement_stage"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "engagement_org_stage_idx" ON "engagement" USING btree ("org_id","stage_id");--> statement-breakpoint

-- Backfill (hand-written): every existing org gets the default stage
-- template (keys match the old enum values), then engagements map their
-- enum status onto the matching stage row. 0009 drops the old column.
INSERT INTO engagement_stage (org_id, key, label, category, position)
SELECT o.id, t.key, t.label, t.category::stage_category, t.position
FROM org o
CROSS JOIN (VALUES
  ('not_started',        'Not started',        'not_started',        0),
  ('awaiting_docs',      'Awaiting docs',      'awaiting_docs',      1),
  ('in_preparation',     'In preparation',     'in_progress',        2),
  ('in_review',          'In review',          'in_progress',        3),
  ('awaiting_signature', 'Awaiting signature', 'awaiting_signature', 4),
  ('filed',              'Filed',              'filed',              5),
  ('noa_received',       'NOA received',       'complete',           6)
) AS t(key, label, category, position);--> statement-breakpoint

UPDATE engagement e
SET stage_id = s.id
FROM engagement_stage s
WHERE s.org_id = e.org_id AND s.key = e.status::text;