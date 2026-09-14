import { geohash8 } from '@/data/geohash';
import { resolveCompassFocusHead } from '@/pubs/pubListState';
import { presentPub } from '@/pubs/pubPresentation';

const position = { lat: 50.08, lng: 14.41 };

const nearest = presentPub(
  { id: 'pub-near', name: 'U Tygra', lat: 50.081, lng: 14.411 },
  position,
);
const friendsPub = presentPub(
  { id: 'pub-far', name: 'Zlý časy', lat: 50.07, lng: 14.44 },
  position,
);

describe('resolveCompassFocusHead', () => {
  it('leaves the head cell to the list when nobody handed a pub over', () => {
    expect(resolveCompassFocusHead(null, [nearest, friendsPub], position)).toBeNull();
  });

  it('points at the friend’s pub, using its real row when we know it', () => {
    const head = resolveCompassFocusHead(
      {
        lat: friendsPub.pub.lat,
        lng: friendsPub.pub.lng,
        name: 'Zlý časy',
        cacheKey: geohash8(friendsPub.pub.lat, friendsPub.pub.lng),
      },
      [nearest, friendsPub],
      position,
    );

    expect(head).toEqual({ pub: friendsPub, real: true });
  });

  it('stands in for a pub we do not have, with a distance but nothing to open', () => {
    const head = resolveCompassFocusHead(
      { lat: 50.05, lng: 14.5, name: 'U Slovanské lípy', cacheKey: 'u2fkbfvn' },
      [nearest, friendsPub],
      position,
    );

    expect(head?.real).toBe(false);
    expect(head?.pub.name).toBe('U Slovanské lípy');
    expect(head?.pub.id).toBe('focus:u2fkbfvn');
    expect(head?.pub.distanceLabel).not.toBeNull();
  });
});
