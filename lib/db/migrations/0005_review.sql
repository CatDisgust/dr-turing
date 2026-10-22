ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "reviewedAt" timestamp;
--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "report" jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studentId" uuid NOT NULL,
	"courseId" text NOT NULL,
	"sessionId" uuid NOT NULL,
	"kpId" text NOT NULL,
	"messageId" uuid NOT NULL,
	"attempt" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Transaction_student_course_idx" ON "Transaction" ("studentId","courseId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Transaction_session_idx" ON "Transaction" ("sessionId");
