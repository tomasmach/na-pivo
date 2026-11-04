import { redirectSystemPath } from '../+native-intent';

describe('deep links in the new look', () => {
  const go = (path: string) => redirectSystemPath({ path, initial: true });

  it('opens a friend invite on the new invite sheet', () => {
    expect(go('https://na-pivo.cz/p/abc123')).toBe('/nv/pozvanka-do-party?code=abc123');
  });

  it('opens email verification and password reset on the new screens', () => {
    expect(go('napivo://auth/verify?token=t1')).toBe('/nv/vysledek?token=t1');
    expect(go('napivo://auth/reset?token=t2')).toBe('/nv/obnova-hesla?token=t2');
  });

  it('opens the counter from the Live Activity link', () => {
    expect(go('napivo://beer')).toBe('/nv/stamgast');
    expect(go('/beer')).toBe('/nv/stamgast');
  });

  it('opens a shared pub on the new pub screen', () => {
    expect(go('napivo://h/u2fkbnjj?n=U%20Tygra')).toMatch(/^\/nv\/hospoda\/u2fkbnjj\?name=U\+Tygra&lat=50\.\d+&lng=14\.\d+$/);
  });
});
