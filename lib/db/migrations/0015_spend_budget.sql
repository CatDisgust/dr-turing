ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "budgetCents" integer DEFAULT 500 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Spend" (
	"microUsd" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" uuid PRIMARY KEY NOT NULL REFERENCES "User"("id")
);
