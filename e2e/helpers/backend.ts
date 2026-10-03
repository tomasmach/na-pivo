import net from 'node:net';

export const apiUrl = `http://127.0.0.1:${process.env.NA_PIVO_E2E_BACKEND_PORT}`;
export type LocalAccount = {
  publicId: string;
  nickname: string; displayName: string; status: string; registered: boolean; verified: boolean;
  ghostMode: boolean; shareDrinks: boolean; shareSpend: boolean; visits: number; activeTokens: number;
  drinks: { beer_name: string; price_czk: number | null; volume_ml: number | null; place_context: string; drink_type: string }[];
};
export async function localRequest(route: string, init?: RequestInit) {
  if (!/^\/(__e2e__|v1)\//.test(route)) throw new Error('Only local test and app endpoints are allowed.');
  const response = await fetch(`${apiUrl}${route}`, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Local ${init?.method ?? 'GET'} ${route.split('?')[0]} returned ${response.status}`);
  return response;
}
export async function resetBackend(scenario = 'base') {
  await localRequest('/__e2e__/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }) });
}
export async function readState<T = Record<string, unknown>>(): Promise<{ accounts: LocalAccount[]; mailCount: number; scenario: T }> {
  return (await localRequest('/__e2e__/state')).json();
}

/** Real password login, kept in memory. The observer never exposes a bearer. */
export async function observer(account: 'primary' | 'second' | 'outsider' = 'primary', password: 'original' | 'new' = 'original') {
  const base = process.env.NA_PIVO_E2E_EMAIL!;
  const email = account === 'primary' ? base : `${account}-${base}`;
  const response = await localRequest('/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: password === 'new' ? process.env.NA_PIVO_E2E_NEW_PASSWORD : process.env.NA_PIVO_E2E_PASSWORD }),
  });
  const { token } = await response.json();
  if (typeof token !== 'string') throw new Error('Fixture observer could not authenticate.');
  return {
    async get(route: string) {
      if (!/^\/v1\//.test(route)) throw new Error('Observers only read local app endpoints.');
      const result = await fetch(`${apiUrl}${route}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      const text = await result.text();
      let body: unknown = null;
      if (text.trim()) {
        try { body = JSON.parse(text); } catch { body = null; }
      }
      return { status: result.status, body: sanitize(body) };
    },
  };
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (/token|email|device_id|^lat$|^lng$|^lon$|latitude|longitude|coordinates/i.test(key)) return [];
    if (key === 'exact_address') return [['exactAddressPresent', Boolean(item)]];
    return [[key, sanitize(item)]];
  }));
}
export function backendAvailability(command: 'offline' | 'online'): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(process.env.NA_PIVO_E2E_CONTROL_SOCKET!);
    socket.setTimeout(30_000, () => socket.destroy(new Error('Backend control timed out.')));
    socket.on('error', reject);
    socket.once('connect', () => socket.write(command));
    socket.once('data', data => { socket.end(); data.toString() === 'ok' ? resolve() : reject(new Error('Backend control failed.')); });
  });
}
