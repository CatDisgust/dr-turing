ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "courseId" text;
--> statement-breakpoint
-- 选课之前的对话都是 COMP5348 的
UPDATE "Chat" SET "courseId" = 'comp5348'
WHERE "courseId" IS NULL AND EXISTS (SELECT 1 FROM "Course" WHERE "id" = 'comp5348');
