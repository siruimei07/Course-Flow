ALTER TABLE "courseflow"."source_documents"
  ADD COLUMN "cleanup_status" text DEFAULT 'not_requested' NOT NULL;
--> statement-breakpoint
ALTER TABLE "courseflow"."source_documents"
  ADD CONSTRAINT "source_documents_cleanup_status_check"
  CHECK ("courseflow"."source_documents"."cleanup_status" in ('not_requested','pending','complete'));
