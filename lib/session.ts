import "server-only";
import { cookies } from "next/headers";
import { STUDENT_COOKIE, STUDENTS, studentByKey } from "./students";

// Demo has no login. The student switcher in the top bar (D11) sets a cookie;
// every request acts as that student, the demo student by default.
export const DEMO_STUDENT_ID = STUDENTS[0].id;

export type User = {
  id: string;
  name: string;
};

export type Session = {
  user: User;
};

export async function auth(): Promise<Session> {
  const store = await cookies();
  const student = studentByKey(store.get(STUDENT_COOKIE)?.value);
  return { user: { id: student.id, name: student.name } };
}
