CREATE TABLE "courseflow"."source_assets" (
	"byte_size" bigint NOT NULL,
	"declared_mime_type" text NOT NULL,
	"height" integer,
	"id" uuid PRIMARY KEY NOT NULL,
	"original_filename" text NOT NULL,
	"position" integer NOT NULL,
	"sha256" text,
	"sniffed_mime_type" text,
	"source_document_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer,
	CONSTRAINT "source_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "source_assets_position_check" CHECK ("courseflow"."source_assets"."position" >= 0),
	CONSTRAINT "source_assets_byte_size_check" CHECK ("courseflow"."source_assets"."byte_size" > 0),
	CONSTRAINT "source_assets_width_check" CHECK ("courseflow"."source_assets"."width" is null or "courseflow"."source_assets"."width" > 0),
	CONSTRAINT "source_assets_height_check" CHECK ("courseflow"."source_assets"."height" is null or "courseflow"."source_assets"."height" > 0)
);
--> statement-breakpoint
CREATE TABLE "courseflow"."source_documents" (
	"content_fingerprint" text,
	"course_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"display_name" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"page_count" integer,
	"status" text DEFAULT 'uploading' NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "source_documents_kind_check" CHECK ("courseflow"."source_documents"."kind" in ('syllabus','assignment_brief','screenshot_set','other')),
	CONSTRAINT "source_documents_status_check" CHECK ("courseflow"."source_documents"."status" in ('uploading','ready','rejected','deleted')),
	CONSTRAINT "source_documents_page_count_check" CHECK ("courseflow"."source_documents"."page_count" is null or "courseflow"."source_documents"."page_count" > 0),
	CONSTRAINT "source_documents_version_check" CHECK ("courseflow"."source_documents"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "courseflow"."source_assets" ADD CONSTRAINT "source_assets_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "courseflow"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."source_documents" ADD CONSTRAINT "source_documents_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courseflow"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_assets_document_position_unique" ON "courseflow"."source_assets" USING btree ("source_document_id","position");--> statement-breakpoint
CREATE INDEX "source_documents_course_created_idx" ON "courseflow"."source_documents" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE INDEX "source_documents_fingerprint_idx" ON "courseflow"."source_documents" USING btree ("course_id","content_fingerprint");
