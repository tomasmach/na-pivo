import test from 'node:test';
import assert from 'node:assert/strict';
import { localMailAction } from './mail.mjs';
const api = 'http://127.0.0.1:18121';
test('Android mail resolves the same port on the host without changing the action', () => {
  for (const purpose of ['verify', 'reset']) {
    const route = purpose === 'verify' ? 'verify-email' : 'reset';
    const action = localMailAction(`http://10.0.2.2:18121/v1/auth/${route}?token=synthetic`, purpose, api, 'android');
    assert.equal(action.href, `${api}/v1/auth/${route}?token=synthetic`);
  }
});
test('iOS loopback mail still resolves', () => {
  assert.equal(localMailAction(`${api}/v1/auth/verify-email?token=synthetic`, 'verify', api, 'ios').origin, api);
});
test('mail cannot escape the owned host, port or action', () => {
  for (const link of [
    'https://10.0.2.2:18121/v1/auth/reset?token=synthetic',
    'http://10.0.2.2:18122/v1/auth/reset?token=synthetic',
    'http://example.test:18121/v1/auth/reset?token=synthetic',
    'http://user:secret@10.0.2.2:18121/v1/auth/reset?token=synthetic',
    'http://10.0.2.2:18121/v1/account/delete?token=synthetic',
    'http://10.0.2.2:18121/v1/auth/reset?token=',
  ]) assert.throws(() => localMailAction(link, 'reset', api, 'android'));
  assert.throws(() => localMailAction('http://10.0.2.2:18121/v1/auth/reset?token=synthetic', 'reset', api, 'ios'));
});
