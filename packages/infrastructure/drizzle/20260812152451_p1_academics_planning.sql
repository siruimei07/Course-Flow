CREATE SCHEMA IF NOT EXISTS "courseflow";
--> statement-breakpoint
CREATE TABLE "courseflow"."academic_calendar_exceptions" (
	"end_date" date NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"suppresses_meetings" boolean DEFAULT false NOT NULL,
	"term_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "academic_calendar_exceptions_kind_check" CHECK ("courseflow"."academic_calendar_exceptions"."kind" in ('reading_week','holiday','closure','other')),
	CONSTRAINT "academic_calendar_exceptions_date_range_check" CHECK ("courseflow"."academic_calendar_exceptions"."start_date" <= "courseflow"."academic_calendar_exceptions"."end_date")
);
--> statement-breakpoint
CREATE TABLE "courseflow"."academic_terms" (
	"archived_at" timestamp with time zone,
	"end_date" date NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"time_zone" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"week_numbering_policy" text DEFAULT 'teaching_weeks_v1' NOT NULL,
	CONSTRAINT "academic_terms_date_range_check" CHECK ("courseflow"."academic_terms"."start_date" <= "courseflow"."academic_terms"."end_date"),
	CONSTRAINT "academic_terms_version_check" CHECK ("courseflow"."academic_terms"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "courseflow"."course_item_labels" (
	"course_item_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	CONSTRAINT "course_item_labels_course_item_id_label_id_pk" PRIMARY KEY("course_item_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "courseflow"."course_items" (
	"course_id" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"details" text,
	"due_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"estimate_source" text,
	"estimated_minutes" integer,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"local_date" date,
	"progress_bps" integer,
	"starts_at" timestamp with time zone,
	"state" text DEFAULT 'planned' NOT NULL,
	"temporal_note" text,
	"time_kind" text NOT NULL,
	"time_zone" text,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "course_items_kind_check" CHECK ("courseflow"."course_items"."kind" in ('assignment','exam','quiz','lab','project','presentation','reading','milestone','other')),
	CONSTRAINT "course_items_state_check" CHECK ("courseflow"."course_items"."state" in ('planned','completed','cancelled')),
	CONSTRAINT "course_items_estimate_check" CHECK ("courseflow"."course_items"."estimated_minutes" is null or "courseflow"."course_items"."estimated_minutes" > 0),
	CONSTRAINT "course_items_progress_check" CHECK ("courseflow"."course_items"."progress_bps" is null or "courseflow"."course_items"."progress_bps" between 0 and 10000),
	CONSTRAINT "course_items_temporal_check" CHECK (
    ("courseflow"."course_items"."time_kind" = 'unscheduled' and "courseflow"."course_items"."local_date" is null and "courseflow"."course_items"."due_at" is null and "courseflow"."course_items"."starts_at" is null and "courseflow"."course_items"."ends_at" is null and "courseflow"."course_items"."time_zone" is null)
    or ("courseflow"."course_items"."time_kind" = 'date' and "courseflow"."course_items"."local_date" is not null and "courseflow"."course_items"."due_at" is null and "courseflow"."course_items"."starts_at" is null and "courseflow"."course_items"."ends_at" is null and "courseflow"."course_items"."time_zone" is null)
    or ("courseflow"."course_items"."time_kind" = 'deadline' and "courseflow"."course_items"."local_date" is null and "courseflow"."course_items"."due_at" is not null and "courseflow"."course_items"."starts_at" is null and "courseflow"."course_items"."ends_at" is null and "courseflow"."course_items"."time_zone" is not null)
    or ("courseflow"."course_items"."time_kind" = 'interval' and "courseflow"."course_items"."local_date" is null and "courseflow"."course_items"."due_at" is null and "courseflow"."course_items"."starts_at" is not null and "courseflow"."course_items"."ends_at" is not null and "courseflow"."course_items"."ends_at" > "courseflow"."course_items"."starts_at" and "courseflow"."course_items"."time_zone" is not null)
  )
);
--> statement-breakpoint
CREATE TABLE "courseflow"."courses" (
	"archived_at" timestamp with time zone,
	"code" text NOT NULL,
	"color_key" text NOT NULL,
	"credit_value_milli" integer,
	"id" uuid PRIMARY KEY NOT NULL,
	"instructor_name" text,
	"letter_grade_scale_id" uuid,
	"section" text,
	"term_id" uuid NOT NULL,
	"time_zone" text NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "courses_color_key_check" CHECK ("courseflow"."courses"."color_key" in ('blue','green','purple','orange','red')),
	CONSTRAINT "courses_credit_check" CHECK ("courseflow"."courses"."credit_value_milli" is null or "courseflow"."courses"."credit_value_milli" >= 0)
);
--> statement-breakpoint
CREATE TABLE "courseflow"."grade_components" (
	"grading_scheme_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"rule_text" text,
	"sort_order" integer NOT NULL,
	"title" text NOT NULL,
	"weight_bps" integer,
	CONSTRAINT "grade_components_weight_check" CHECK ("courseflow"."grade_components"."weight_bps" is null or "courseflow"."grade_components"."weight_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "courseflow"."grade_results" (
	"earned_milli" bigint NOT NULL,
	"grade_component_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"note" text,
	"possible_milli" bigint NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "grade_results_grade_component_id_unique" UNIQUE("grade_component_id"),
	CONSTRAINT "grade_results_earned_check" CHECK ("courseflow"."grade_results"."earned_milli" >= 0),
	CONSTRAINT "grade_results_possible_check" CHECK ("courseflow"."grade_results"."possible_milli" > 0)
);
--> statement-breakpoint
CREATE TABLE "courseflow"."grading_schemes" (
	"condition_text" text,
	"course_id" uuid NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courseflow"."letter_grade_bands" (
	"letter" text NOT NULL,
	"minimum_percent_bps" integer NOT NULL,
	"scale_id" uuid NOT NULL,
	CONSTRAINT "letter_grade_bands_scale_id_letter_pk" PRIMARY KEY("scale_id","letter"),
	CONSTRAINT "letter_grade_bands_letter_check" CHECK ("courseflow"."letter_grade_bands"."letter" in ('A','B','C','D','F')),
	CONSTRAINT "letter_grade_bands_minimum_check" CHECK ("courseflow"."letter_grade_bands"."minimum_percent_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "courseflow"."letter_grade_scales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courseflow"."meeting_exceptions" (
	"action" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"meeting_pattern_id" uuid NOT NULL,
	"note" text,
	"occurrence_date" date NOT NULL,
	"replacement_date" date,
	"replacement_end_time" time(0),
	"replacement_location_text" text,
	"replacement_start_time" time(0),
	"replacement_time_zone" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "meeting_exceptions_action_check" CHECK ("courseflow"."meeting_exceptions"."action" in ('cancelled','rescheduled','kept')),
	CONSTRAINT "meeting_exceptions_replacement_check" CHECK (
    ("courseflow"."meeting_exceptions"."action" = 'rescheduled' and "courseflow"."meeting_exceptions"."replacement_date" is not null and "courseflow"."meeting_exceptions"."replacement_start_time" is not null and "courseflow"."meeting_exceptions"."replacement_end_time" is not null and "courseflow"."meeting_exceptions"."replacement_end_time" > "courseflow"."meeting_exceptions"."replacement_start_time")
    or ("courseflow"."meeting_exceptions"."action" in ('cancelled','kept') and "courseflow"."meeting_exceptions"."replacement_date" is null and "courseflow"."meeting_exceptions"."replacement_start_time" is null and "courseflow"."meeting_exceptions"."replacement_end_time" is null and "courseflow"."meeting_exceptions"."replacement_time_zone" is null)
  )
);
--> statement-breakpoint
CREATE TABLE "courseflow"."meeting_patterns" (
	"archived_at" timestamp with time zone,
	"course_id" uuid NOT NULL,
	"effective_end_date" date,
	"effective_start_date" date,
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"local_end_time" time(0) NOT NULL,
	"local_start_time" time(0) NOT NULL,
	"location_text" text,
	"section" text,
	"title" text,
	"version" integer DEFAULT 1 NOT NULL,
	"weekdays_mask" smallint NOT NULL,
	CONSTRAINT "meeting_patterns_kind_check" CHECK ("courseflow"."meeting_patterns"."kind" in ('lecture','tutorial','practical','other')),
	CONSTRAINT "meeting_patterns_time_check" CHECK ("courseflow"."meeting_patterns"."local_end_time" > "courseflow"."meeting_patterns"."local_start_time"),
	CONSTRAINT "meeting_patterns_weekdays_check" CHECK ("courseflow"."meeting_patterns"."weekdays_mask" between 1 and 127)
);
--> statement-breakpoint
CREATE TABLE "courseflow"."task_labels" (
	"color_key" text NOT NULL,
	"display_name" text NOT NULL,
	"id" uuid PRIMARY KEY NOT NULL,
	"normalized_name" text NOT NULL,
	"term_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "task_labels_color_key_check" CHECK ("courseflow"."task_labels"."color_key" in ('blue','green','purple','orange','red'))
);
--> statement-breakpoint
CREATE TABLE "courseflow"."user_profiles" (
	"active_term_id" uuid,
	"auth_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_name" text,
	"id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'zh-CN' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"week_starts_on" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "user_profiles_auth_subject_unique" UNIQUE("auth_subject"),
	CONSTRAINT "user_profiles_week_starts_on_check" CHECK ("courseflow"."user_profiles"."week_starts_on" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "courseflow"."academic_calendar_exceptions" ADD CONSTRAINT "academic_calendar_exceptions_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "courseflow"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."academic_terms" ADD CONSTRAINT "academic_terms_owner_user_id_user_profiles_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "courseflow"."user_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."course_item_labels" ADD CONSTRAINT "course_item_labels_course_item_id_course_items_id_fk" FOREIGN KEY ("course_item_id") REFERENCES "courseflow"."course_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."course_item_labels" ADD CONSTRAINT "course_item_labels_label_id_task_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "courseflow"."task_labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."course_items" ADD CONSTRAINT "course_items_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courseflow"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."courses" ADD CONSTRAINT "courses_letter_grade_scale_id_letter_grade_scales_id_fk" FOREIGN KEY ("letter_grade_scale_id") REFERENCES "courseflow"."letter_grade_scales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."courses" ADD CONSTRAINT "courses_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "courseflow"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."grade_components" ADD CONSTRAINT "grade_components_grading_scheme_id_grading_schemes_id_fk" FOREIGN KEY ("grading_scheme_id") REFERENCES "courseflow"."grading_schemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."grade_results" ADD CONSTRAINT "grade_results_grade_component_id_grade_components_id_fk" FOREIGN KEY ("grade_component_id") REFERENCES "courseflow"."grade_components"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."grade_results" ADD CONSTRAINT "grade_results_recorded_by_user_id_user_profiles_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "courseflow"."user_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."grading_schemes" ADD CONSTRAINT "grading_schemes_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courseflow"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."letter_grade_bands" ADD CONSTRAINT "letter_grade_bands_scale_id_letter_grade_scales_id_fk" FOREIGN KEY ("scale_id") REFERENCES "courseflow"."letter_grade_scales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."letter_grade_scales" ADD CONSTRAINT "letter_grade_scales_owner_user_id_user_profiles_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "courseflow"."user_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."meeting_exceptions" ADD CONSTRAINT "meeting_exceptions_meeting_pattern_id_meeting_patterns_id_fk" FOREIGN KEY ("meeting_pattern_id") REFERENCES "courseflow"."meeting_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."meeting_patterns" ADD CONSTRAINT "meeting_patterns_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "courseflow"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courseflow"."task_labels" ADD CONSTRAINT "task_labels_term_id_academic_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "courseflow"."academic_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_calendar_exceptions_range_idx" ON "courseflow"."academic_calendar_exceptions" USING btree ("term_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "academic_terms_owner_idx" ON "courseflow"."academic_terms" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "course_item_labels_label_idx" ON "courseflow"."course_item_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "course_items_course_deleted_idx" ON "courseflow"."course_items" USING btree ("course_id","deleted_at");--> statement-breakpoint
CREATE INDEX "course_items_date_idx" ON "courseflow"."course_items" USING btree ("local_date");--> statement-breakpoint
CREATE INDEX "course_items_due_idx" ON "courseflow"."course_items" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "course_items_start_idx" ON "courseflow"."course_items" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "courses_term_archived_idx" ON "courseflow"."courses" USING btree ("term_id","archived_at");--> statement-breakpoint
CREATE INDEX "grade_components_scheme_order_idx" ON "courseflow"."grade_components" USING btree ("grading_scheme_id","sort_order");--> statement-breakpoint
CREATE INDEX "grading_schemes_course_idx" ON "courseflow"."grading_schemes" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grading_schemes_primary_unique" ON "courseflow"."grading_schemes" USING btree ("course_id") WHERE "courseflow"."grading_schemes"."is_primary" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_exceptions_occurrence_unique" ON "courseflow"."meeting_exceptions" USING btree ("meeting_pattern_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "meeting_patterns_course_archived_idx" ON "courseflow"."meeting_patterns" USING btree ("course_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_labels_term_name_unique" ON "courseflow"."task_labels" USING btree ("term_id","normalized_name");
