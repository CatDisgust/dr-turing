CREATE TABLE IF NOT EXISTS "Event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studentId" uuid NOT NULL,
	"courseId" text NOT NULL,
	"sessionId" uuid NOT NULL,
	"messageId" uuid NOT NULL,
	"kpId" text,
	"type" varchar(32) NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Event_student_course_idx" ON "Event" ("studentId", "courseId");
