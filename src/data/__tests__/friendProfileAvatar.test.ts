import { parseProfile } from '../friendsClient';

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}`,
}));

describe('parseProfile avatar', () => {
  it('prefixes a relative media path with the backend', () => {
    expect(parseProfile({ avatar_url: '/media/avatars/a.webp?v=1' }).avatarUrl).toBe(
      'http://127.0.0.1:8012/media/avatars/a.webp?v=1',
    );
  });

  it('keeps an absolute URL and a missing photo as they are', () => {
    expect(parseProfile({ avatar_url: 'https://api.na-pivo.cz/media/avatars/a.webp' }).avatarUrl).toBe(
      'https://api.na-pivo.cz/media/avatars/a.webp',
    );
    expect(parseProfile({ avatar_url: null }).avatarUrl).toBeNull();
  });
});
