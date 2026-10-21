INSERT INTO "User" ("id", "email", "name") VALUES ('00000000-0000-4000-8000-000000000001', 'demo@dr-turing.local', '演示学生') ON CONFLICT ("id") DO NOTHING;
