CREATE TABLE IF NOT EXISTS "Course" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"graph" jsonb NOT NULL,
	"files" jsonb NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
