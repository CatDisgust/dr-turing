import "server-only";

// Demo has no login. Every request acts as one fixed student; D11 replaces
// this with the student switcher (A / B) in the top bar.
export const DEMO_STUDENT_ID = "00000000-0000-4000-8000-000000000001";

export type User = {
  id: string;
  name: string;
};

export type Session = {
  user: User;
};

export function auth(): Promise<Session> {
  return Promise.resolve({ user: { id: DEMO_STUDENT_ID, name: "演示学生" } });
}
