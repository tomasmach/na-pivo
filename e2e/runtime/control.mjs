import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { apiUrl, observer, readState, resetBackend } from '../helpers/backend.ts';
import { readHomePoint } from './home-point.mjs';
import { localMailAction } from './mail.mjs';
import { appProcess, clipboard, openDevelopmentBundle, openLink, resetApp, screenshot } from './device.mjs';

export function controlServer({ online, offline }) {
  const observers = new Map();
  const capabilities = new Map();
  const device = process.env.NA_PIVO_E2E_DEVICE;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const chunks = [];
      let length = 0;
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 8192) throw new Error('Control payload too large.');
        chunks.push(chunk);
      }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      let result = { ok: true };
      if (request.method === 'POST' && url.pathname === '/wait') await delay(Math.min(Math.max(Number(body.milliseconds) || 0, 0), 1000));
      else if (request.method === 'POST' && url.pathname === '/online') await online();
      else if (request.method === 'POST' && url.pathname === '/offline') await offline();
      else if (request.method === 'POST' && url.pathname === '/reset') {
        // Stop old app queues before bringing the backend online or seeding it.
        // Reinstall our built client instead of copying its native bundle.
        resetApp();
        await online();
        await resetBackend(body.scenario || 'base');
        observers.clear();
        capabilities.clear();
      } else if (request.method === 'GET' && url.pathname === '/state') result = privateProjection(await readState());
      else if (request.method === 'GET' && url.pathname === '/home-point') result = readHomePoint(device);
      else if (request.method === 'GET' && url.pathname === '/app/process') result = { pid: appProcess() };
      else if (request.method === 'POST' && url.pathname === '/app/open') openDevelopmentBundle();
      else if (request.method === 'POST' && url.pathname === '/observe') {
        const account = body.account || 'primary';
        if (!['primary', 'second', 'outsider'].includes(account) || !/^\/v1\//.test(body.route)) throw new Error('Invalid observer.');
        const password = body.password === 'new' ? 'new' : 'original';
        const key = `${account}:${password}`;
        if (!observers.has(key)) observers.set(key, await observer(account, password));
        result = await observers.get(key).get(body.route);
      } else if (request.method === 'POST' && ['/mail/verify', '/mail/reset'].includes(url.pathname)) {
        const purpose = url.pathname.split('/').at(-1);
        const message = await (await fetch(`${apiUrl}/__e2e__/mail?purpose=${purpose}`)).json();
        const action = localMailAction(message.text || '', purpose, apiUrl,
          process.env.NA_PIVO_E2E_PLATFORM || 'ios');
        if (purpose === 'verify') {
          const verified = await fetch(action, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
          if (verified.status !== 200) throw new Error('Local verification failed.');
        } else {
          // The app consumes the link token without displaying its manual-code
          // field. Neither the token nor the rendered message enters Maestro.
          openLink(`napivo://auth/reset?token=${encodeURIComponent(action.searchParams.get('token'))}`);
        }
      } else if (request.method === 'GET' && url.pathname === '/mail/export') {
        const mail = await fetch(`${apiUrl}/__e2e__/mail?purpose=export`);
        const message = await mail.json();
        result = { status: mail.status, attachments: message.attachments || 0 };
      } else if (request.method === 'POST' && url.pathname === '/open-clipboard') {
        const link = new URL(await clipboard());
        if (link.origin !== 'https://na-pivo.cz' || !/^\/(p|t)\/[a-zA-Z0-9_-]+$/.test(link.pathname)) throw new Error('Clipboard has no expected local fixture invitation.');
        openLink(`napivo:/${link.pathname}`);
      } else if (request.method === 'POST' && url.pathname === '/invite/open') {
        const code = (await readState()).scenario.inviteCode;
        if (typeof code !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(code)) throw new Error('Expected fixture invitation.');
        openLink(`napivo://parta/pozvanka?code=${encodeURIComponent(code)}`);
      } else if (request.method === 'POST' && url.pathname.startsWith('/capability/')) {
        if (!/^[a-z0-9-]{1,40}$/.test(body.name)) throw new Error('Use a capability alias, never a raw token.');
        if (url.pathname === '/capability/store') {
          const link = new URL(await clipboard());
          if (link.origin !== 'https://na-pivo.cz' || !/^\/t\/[a-zA-Z0-9_-]+$/.test(link.pathname)) throw new Error('Expected a copied tour link.');
          capabilities.set(body.name, link.pathname);
        } else if (url.pathname === '/capability/discover') {
          if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 60) throw new Error('Expected a fixture tour title.');
          // Read the real anonymous catalogue. Keep its capability token in this
          // process; Maestro receives only the publication identity and content.
          const discovered = await fetch(`${apiUrl}/v1/tour-publications/search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: body.title }), redirect: 'manual', signal: AbortSignal.timeout(15000),
          });
          if (discovered.status !== 200) throw new Error('Public tour search failed.');
          const catalogue = await discovered.json();
          const matches = catalogue.results?.filter(tour => tour.title === body.title);
          if (matches?.length !== 1 || typeof matches[0].token !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(matches[0].token)) throw new Error('Expected one published fixture tour.');
          const tour = matches[0];
          capabilities.set(body.name, `/t/${tour.token}`);
          result = { status: discovered.status, id: tour.id, title: tour.title, stopCount: tour.stop_count };
        } else {
          const pathname = capabilities.get(body.name);
          if (!pathname) throw new Error('Capability was not copied in this test.');
          if (url.pathname === '/capability/open') openLink(`napivo:/${pathname}`);
          else if (url.pathname === '/capability/status') {
            // A capability is public to its holder. Logging in here would rotate
            // deletion_epoch and invalidate later sensitive writes from the app.
            const observed = await fetch(`${apiUrl}/v1/tour-shares/${pathname.split('/').at(-1)}`, {
              redirect: 'manual', signal: AbortSignal.timeout(15000),
            });
            await observed.body?.cancel();
            result = { status: observed.status };
            if (body.distinctFrom !== undefined) {
              if (!capabilities.has(body.distinctFrom)) throw new Error('Unknown comparison capability.');
              result.distinct = pathname !== capabilities.get(body.distinctFrom);
            }
          } else throw new Error('Unknown capability action.');
        }
      } else if (request.method === 'POST' && url.pathname === '/media') {
        const { addGalleryFixtures } = await import('../helpers/media.ts');
        addGalleryFixtures();
      } else if (request.method === 'POST' && url.pathname === '/screenshot') {
        if (!/^[a-z0-9-]+$/.test(body.name)) throw new Error('Use a safe screenshot name.');
        const directory = path.join(process.env.NA_PIVO_E2E_OUTPUT, body.debug === true ? 'private-debug' : 'screenshots');
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        screenshot(path.join(directory, `${body.name}.png`));
      } else {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch {
      // Never serialize an exception containing a mail link or response body.
      response.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Local control action failed.' }));
    }
  });
  server.listen(Number(process.env.NA_PIVO_E2E_CONTROL_PORT), '127.0.0.1');
  return server;
}

function privateProjection(value) {
  if (Array.isArray(value)) return value.map(privateProjection);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (/^lat$|^lng$|^lon$|latitude|longitude|coordinates/i.test(key)) return [];
    if (typeof item === 'string' && /token|email|inviteCode/i.test(key)) return [];
    return [[key, privateProjection(item)]];
  }));
}
