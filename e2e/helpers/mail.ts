import { apiUrl, localRequest } from './backend';

export async function mailAction(purpose: 'verify' | 'reset'): Promise<URL> {
  const message = await (await localRequest(`/__e2e__/mail?purpose=${purpose}`)).json();
  const links: string[] = message.text.match(/https?:\/\/[^\s<>]+/g) ?? [];
  const action = links.map(link => new URL(link)).find(link => link.origin === apiUrl && link.pathname === `/v1/auth/${purpose === 'verify' ? 'verify-email' : 'reset'}`);
  if (!action?.searchParams.has('token')) throw new Error('The local email has no expected action link.');
  return action;
}

export async function verifyEmail() {
  // The link stays in memory; never put it in an agent prompt or trace.
  const response = await fetch(await mailAction('verify'), { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  if (response.status !== 200) throw new Error(`Local email verification returned ${response.status}.`);
}

export async function resetCode() {
  return (await mailAction('reset')).searchParams.get('token')!;
}
