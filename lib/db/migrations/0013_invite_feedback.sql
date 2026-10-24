CREATE TABLE IF NOT EXISTS "Invite" (
	"code" text PRIMARY KEY NOT NULL,
	"courseLimit" integer DEFAULT 2 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"dailyLimit" integer DEFAULT 100 NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"lastSeenAt" timestamp,
	"name" text NOT NULL,
	"userId" uuid NOT NULL REFERENCES "User"("id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "Feedback" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page" text,
	"text" text NOT NULL,
	"userId" uuid NOT NULL REFERENCES "User"("id")
);
