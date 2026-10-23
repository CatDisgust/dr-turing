CREATE TABLE IF NOT EXISTS "StudentModel" (
	"studentId" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
