ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "ownerId" uuid REFERENCES "User"("id");
--> statement-breakpoint
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "generations" integer DEFAULT 0 NOT NULL;
