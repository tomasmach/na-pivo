
import type { PubFavorite } from '@/stores/pubFavoritesStore';

import { savedFavoritePubs } from '../profileModel';

describe('savedFavoritePubs', () => {
  const favorite = (name: string, updatedAt: string, extra: Partial<PubFavorite> = {}): PubFavorite => ({
    name,
    lat: 50.08,
    lng: 14.42,
    updatedAt,
    ...extra,
  });

  it('lists the newest heart first and leaves out reported pubs', () => {
    const pubs = savedFavoritePubs(
      {
        aaa: favorite('Lokál', '2026-10-01T10:00:00.000Z', { city: 'Praha', externalId: 'ext-1' }),
        bbb: favorite('U Hrocha', '2026-10-03T10:00:00.000Z'),
        ccc: favorite('Bašta', '2026-10-02T10:00:00.000Z'),
        ddd: favorite('Výčep', '2026-10-04T10:00:00.000Z', { externalId: 'ext-2' }),
      },
      ['ccc'],
      ['ext-2'],
    );
    expect(pubs.map((pub) => pub.name)).toEqual(['U Hrocha', 'Lokál']);
    expect(pubs[0].id).toBe('');
    expect(pubs[1]).toMatchObject({ id: 'ext-1', city: 'Praha' });
  });
});
