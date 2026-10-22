CREATE TABLE IF NOT EXISTS "LearnerState" (
	"studentId" uuid NOT NULL,
	"courseId" text NOT NULL,
	"state" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "LearnerState_studentId_courseId_pk" PRIMARY KEY("studentId","courseId")
);
