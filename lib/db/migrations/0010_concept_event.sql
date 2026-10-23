CREATE TABLE IF NOT EXISTS "ConceptEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studentId" uuid NOT NULL,
	"conceptId" text NOT NULL,
	"sessionId" uuid,
	"type" varchar(16) NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ConceptEvent_student_idx" ON "ConceptEvent" ("studentId");
