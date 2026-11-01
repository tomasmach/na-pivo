type Intent = typeof import('../+native-intent');

function load(newLook: boolean): Intent {
  const previous = process.env.EXPO_PUBLIC_NEW_LOOK;
  process.env.EXPO_PUBLIC_NEW_LOOK = newLook ? '1' : '0';
  let mod: Intent | undefined;
  jest.isolateModules(() => {
    mod = require('../+native-intent') as Intent;
  });
  process.env.EXPO_PUBLIC_NEW_LOOK = previous;
  return mod!;
}

describe('deep links in the new look', () => {
  const go = (path: string) => load(true).redirectSystemPath({ path, initial: true });

  it('opens a friend invite on the new invite sheet', () => {
    expect(go('https://na-pivo.cz/p/abc123')).toBe('/nv/pozvanka-do-party?code=abc123');
  });

  it('opens email verification and password reset on the new screens', () => {
    expect(go('napivo://auth/verify?token=t1')).toBe('/nv/vysledek?token=t1');
    expect(go('napivo://auth/reset?token=t2')).toBe('/nv/obnova-hesla?token=t2');
  });

  it('opens a shared pub on the new pub screen', () => {
    expect(go('napivo://h/u2fkbnjj?n=U%20Tygra')).toMatch(/^\/nv\/hospoda\/u2fkbnjj\?name=U\+Tygra&lat=50\.\d+&lng=14\.\d+$/);
  });

  it('leaves the old app untouched without the flag', () => {
    const old = load(false).redirectSystemPath;
    expect(old({ path: 'https://na-pivo.cz/p/abc123', initial: true })).toBe('/parta/pozvanka?code=abc123');
    expect(old({ path: 'napivo://auth/verify?token=t1', initial: true })).toBe('napivo://auth/verify?token=t1');
  });
});
