INSERT INTO "User" ("id", "email", "name") VALUES
  ('00000000-0000-4000-8000-000000000002', 'a@dr-turing.local', '学生 A'),
  ('00000000-0000-4000-8000-000000000003', 'b@dr-turing.local', '学生 B')
ON CONFLICT ("id") DO NOTHING;
