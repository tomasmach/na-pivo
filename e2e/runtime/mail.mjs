// Django builds mail links from the incoming app request. Android addresses
// the same isolated host backend as 10.0.2.2; the host controller uses loopback.
export function localMailAction(text, purpose, apiUrl, platform) {
  const host = new URL(apiUrl);
  if (host.protocol !== 'http:' || host.hostname !== '127.0.0.1' || !host.port ||
      host.username || host.password || host.pathname !== '/' || host.search || host.hash ||
      !['verify', 'reset'].includes(purpose)) throw new Error('Invalid local mail origin.');
  const origins = [host.origin];
  if (platform === 'android') origins.push(`http://10.0.2.2:${host.port}`);
  const expected = `/v1/auth/${purpose === 'verify' ? 'verify-email' : 'reset'}`;
  for (const raw of text.match(/https?:\/\/[^\s<>]+/g) || []) {
    let link;
    try { link = new URL(raw); } catch { continue; }
    if (!origins.includes(link.origin) || link.username || link.password || link.hash ||
        link.pathname !== expected || !link.searchParams.get('token')) continue;
    link.hostname = host.hostname;
    return link;
  }
  throw new Error('Expected local email action is not available.');
}
