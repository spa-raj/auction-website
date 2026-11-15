import type { DemoUser } from './catalog';

export const demoUserKey = 'auction-part-2-active-user';

export function rememberTabUser(id: number): void {
  try { sessionStorage.setItem(demoUserKey, String(id)); }
  catch { /* Allow selection for this page when browser storage is unavailable. */ }
}

export function initialTabUser(users: DemoUser[]): number | undefined {
  if (!users.length) return undefined;
  try {
    const saved = Number(sessionStorage.getItem(demoUserKey));
    if (users.some(user => user.id === saved)) return saved;
  } catch { /* Fall back to a random demo user when browser storage is unavailable. */ }
  const id = users[Math.floor(Math.random() * users.length)].id;
  rememberTabUser(id);
  return id;
}
