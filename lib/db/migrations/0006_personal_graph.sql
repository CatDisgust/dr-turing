CREATE TABLE IF NOT EXISTS "PersonalGraph" (
	"studentId" uuid PRIMARY KEY NOT NULL,
	"graph" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
