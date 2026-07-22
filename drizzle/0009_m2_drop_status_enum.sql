DROP INDEX "engagement_org_status_idx";--> statement-breakpoint
ALTER TABLE "engagement" ALTER COLUMN "stage_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "engagement" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."engagement_status";