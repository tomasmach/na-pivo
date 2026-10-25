import {
  drinkAbv,
  estimateAlcohol,
  isBodyProfile,
  type BodyProfile,
  type EstimateDrink,
} from '../alcoholEstimate';

const PROFILE: BodyProfile = { sex: 'male', age: 32, heightCm: 182, weightKg: 84 };

function at(hhmm: string, day = 17): string {
  return new Date(`2026-10-${day}T${hhmm}:00`).toISOString();
}

function beer(id: string, time: string, name = 'Plzeň 12°'): EstimateDrink {
  return { id, beerName: name, drinkType: 'beer', volumeMl: 500, at: at(time) };
}

const EVENING: EstimateDrink[] = [
  beer('1', '19:10'),
  beer('2', '19:50'),
  beer('3', '20:35'),
  beer('4', '21:20'),
  { id: '5', beerName: 'Panák', drinkType: 'shot', volumeMl: 40, at: at('22:05') },
];

describe('drinkAbv', () => {
  it.each([
    ['Plzeň 12°', 'beer', 5],
    ['Kozel 10°', 'beer', 4.2],
    ['Porter 18°', 'beer', 7.6],
    ['IPA', 'beer', 6],
    ['Birell', 'beer', 0],
    ['Radegast nealko', 'beer', 0],
    ['Bernard Free', 'beer', 0],
    ['Gluten Free IPA 12°', 'beer', 5],
    ['HAKSNA Clear Mind', 'beer', 0],
    ['Clock Krystus', 'beer', 0],
    ['Litovel Svěží pomelo', 'beer', 0],
    ['Gambrinus 0,0', 'beer', 0],
    ['Zlatopramen Radler', 'beer', 2.5],
    ['Panák', 'shot', 40],
    ['Víno', 'wine', 12],
    ['Kofola', 'soft_drink', 0],
  ] as const)('%s (%s) → %s %%', (beerName, drinkType, abv) => {
    expect(drinkAbv({ beerName, drinkType })).toBe(abv);
  });
});

describe('estimateAlcohol', () => {
  it('matches the reference evening: ~0.9 ‰ at 22:40, cautious zero at 13:00 next day', () => {
    const estimate = estimateAlcohol(EVENING, PROFILE, Date.parse(at('22:40')));

    expect(estimate).not.toBeNull();
    expect(estimate!.now).toBeCloseTo(0.92, 1);
    expect(estimate!.low).toBeCloseTo(0.6, 1);
    expect(estimate!.high).toBeCloseTo(1.39, 1);
    expect(estimate!.zeroAt.getTime()).toBe(Date.parse(at('13:00', 18)));
  });

  it('keeps counting overnight while nothing new is logged', () => {
    const morning = estimateAlcohol(EVENING, PROFILE, Date.parse(at('07:30', 18)));

    expect(morning!.now).toBe(0);
    expect(morning!.high).toBeGreaterThan(0.4);
    expect(morning!.zeroAt.getTime()).toBe(Date.parse(at('13:00', 18)));
  });

  it('is gone once the cautious run reaches zero', () => {
    expect(estimateAlcohol(EVENING, PROFILE, Date.parse(at('13:00', 18)))).toBeNull();
  });

  it('ignores soft drinks, alcohol-free beer and drinks older than three days', () => {
    const drinks: EstimateDrink[] = [
      { id: 'k', beerName: 'Kofola', drinkType: 'soft_drink', at: at('20:00') },
      beer('n', '20:10', 'Birell'),
      { ...beer('old', '19:00'), at: at('19:00', 14) },
    ];

    expect(estimateAlcohol(drinks, PROFILE, Date.parse(at('21:00')))).toBeNull();
  });

  it('keeps a heavy night until the cautious run is at zero, even past 24 hours', () => {
    const small: BodyProfile = { sex: 'female', age: 30, heightCm: 165, weightKg: 58 };
    const night = ['18:00', '19:00', '20:00', '21:00', '22:00'].map((time, i) => beer(`h${i}`, time));
    const evening = estimateAlcohol(night, small, Date.parse(at('23:00')));
    const nextEvening = estimateAlcohol(night, small, Date.parse(at('18:30', 18)));

    expect(nextEvening?.zeroAt.getTime()).toBe(evening!.zeroAt.getTime());
  });

  it('flags the first minutes after a drink as still absorbing', () => {
    const first = [beer('a', '20:00')];

    expect(estimateAlcohol(first, PROFILE, Date.parse(at('20:05')))!.absorbing).toBe(true);
    expect(estimateAlcohol(first, PROFILE, Date.parse(at('21:00')))!.absorbing).toBe(false);
  });

  it('tells where a fresh round peaks while it is still being absorbed', () => {
    const nine = Array.from({ length: 9 }, (_, i) => beer(`n${i}`, '20:00'));
    const justLogged = estimateAlcohol(nine, PROFILE, Date.parse(at('20:01')))!;
    const absorbed = estimateAlcohol(nine, PROFILE, Date.parse(at('20:45')))!;

    expect(justLogged.now).toBeLessThan(0.2);
    expect(justLogged.rising!.promile).toBeGreaterThan(2.5);
    expect(justLogged.rising!.promile).toBeCloseTo(absorbed.now, 2);
    expect(justLogged.rising!.at.getTime()).toBe(Date.parse(at('20:44')));
    expect(absorbed.rising).toBeNull();
  });

  it('ignores drinks timed in the future', () => {
    expect(estimateAlcohol([beer('f', '23:00')], PROFILE, Date.parse(at('21:00')))).toBeNull();
  });

  it('gives a smaller body a higher level from the same drinks', () => {
    const now = Date.parse(at('22:40'));
    const small = estimateAlcohol(EVENING, { sex: 'female', age: 32, heightCm: 165, weightKg: 58 }, now);

    expect(small!.now).toBeGreaterThan(estimateAlcohol(EVENING, PROFILE, now)!.now);
  });
});

describe('isBodyProfile', () => {
  it('accepts a full profile and rejects malformed or out-of-range ones', () => {
    expect(isBodyProfile(PROFILE)).toBe(true);
    expect(isBodyProfile({ ...PROFILE, sex: 'other' })).toBe(false);
    expect(isBodyProfile({ ...PROFILE, weightKg: 12 })).toBe(false);
    expect(isBodyProfile({ ...PROFILE, age: 32.5 })).toBe(false);
    expect(isBodyProfile(null)).toBe(false);
  });
});
