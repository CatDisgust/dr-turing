CREATE TABLE IF NOT EXISTS "DemoSnapshot" (
	"name" text PRIMARY KEY NOT NULL,
	"studentId" uuid NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
