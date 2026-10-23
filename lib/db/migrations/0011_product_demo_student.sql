INSERT INTO "User" ("id", "email", "name") VALUES
  ('00000000-0000-4000-8000-000000000004', 'show@dr-turing.local', '产品演示学生')
ON CONFLICT ("id") DO NOTHING;
