import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoUserKey, initialTabUser, rememberTabUser } from './demo-user';

const users = Array.from({length: 10}, (_, index) => ({ id: index + 1, name: `User ${index + 1}` }));
function newTabStorage() {
  const values = new Map<string,string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key,value); } };
  vi.stubGlobal('sessionStorage',storage);
  return storage;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('tab-specific demo identity', () => {
  it('randomly assigns and saves an initial user in each fresh tab', () => {
    vi.spyOn(Math,'random').mockReturnValueOnce(0.15).mockReturnValueOnce(0.95);
    const firstTab = newTabStorage();
    expect(initialTabUser(users)).toBe(2);
    expect(firstTab.getItem(demoUserKey)).toBe('2');
    const secondTab = newTabStorage();
    expect(initialTabUser(users)).toBe(10);
    expect(secondTab.getItem(demoUserKey)).toBe('10');
    expect(firstTab.getItem(demoUserKey)).toBe('2');
  });
  it('keeps the saved identity through repeated initialization and footer switches', () => {
    newTabStorage();
    const random = vi.spyOn(Math,'random').mockReturnValue(0.25);
    expect(initialTabUser(users)).toBe(3);
    expect(initialTabUser(users)).toBe(3);
    rememberTabUser(7);
    expect(initialTabUser(users)).toBe(7);
    expect(random).toHaveBeenCalledTimes(1);
  });
  it('replaces a stale or malformed stored user with a random valid user', () => {
    const storage = newTabStorage();
    vi.spyOn(Math,'random').mockReturnValue(0.4);
    for (const invalid of ['999','not-a-user','']) {
      storage.setItem(demoUserKey,invalid);
      expect(initialTabUser(users)).toBe(5);
      expect(storage.getItem(demoUserKey)).toBe('5');
    }
  });
  it('ignores the previous browser-wide localStorage selection', () => {
    newTabStorage();
    const getItem = vi.fn(() => '1');
    vi.stubGlobal('localStorage',{getItem});
    vi.spyOn(Math,'random').mockReturnValue(0.8);
    expect(initialTabUser(users)).toBe(9);
    expect(getItem).not.toHaveBeenCalled();
  });
  it('handles an empty user list without storing an invalid selection', () => {
    const storage = newTabStorage();
    expect(initialTabUser([])).toBeUndefined();
    expect(storage.getItem(demoUserKey)).toBeNull();
  });
});
