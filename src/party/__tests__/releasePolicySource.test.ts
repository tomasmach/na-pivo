import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...segments: string[]): string =>
  readFileSync(join(__dirname, '..', '..', '..', ...segments), 'utf8');

const squash = (source: string): string => source.replace(/\s+/g, ' ');

const gameSources = [
  { name: 'src/party/gameCatalog.ts', text: read('src', 'party', 'gameCatalog.ts') },
  { name: 'src/party/gameContent.ts', text: read('src', 'party', 'gameContent.ts') },
  { name: 'src/party/PartyGameScreen.tsx', text: read('src', 'party', 'PartyGameScreen.tsx') },
];

const bannedLiterals = ['Vodopád', 'Na pití', 'odpovídá — nebo pije', 'Máš 0 piv', 'Přidat další'];

describe('release policy: game sources', () => {
  it.each(gameSources.map((s) => [s.name, s.text] as const))(
    '%s contains no retired copy',
    (_name, text) => {
      const flat = squash(text);
      for (const literal of bannedLiterals) {
        expect(flat).not.toContain(literal);
      }
      for (const line of text.split('\n')) {
        expect(line).not.toMatch(/kdo[^.!?]*pije/i);
      }
    },
  );
});

describe('release policy: retired evening copy', () => {
  const eveningSources = [
    { name: 'src/party/LivePartyMockScreen.tsx', text: read('src', 'party', 'LivePartyMockScreen.tsx') },
    { name: 'src/party/gameContent.ts', text: read('src', 'party', 'gameContent.ts') },
    { name: 'src/feed/roast.ts', text: read('src', 'feed', 'roast.ts') },
  ];
  const retiredEveningCopy = ['Ještě jedno', 'Výmluvy, proč ještě jedno', 'rychlejší než obvykle'];

  it.each(eveningSources.map((s) => [s.name, s.text] as const))(
    '%s contains no retired evening copy',
    (_name, text) => {
      const flat = squash(text);
      for (const literal of retiredEveningCopy) {
        expect(flat).not.toContain(literal);
      }
    },
  );
});

describe('release policy: live activity sources', () => {
  it('iOS BeerEveningLiveActivity has exactly two Zapsat stejné actions and no retired copy', () => {
    const text = read('src', 'liveActivity', 'BeerEveningLiveActivity.tsx');
    expect(text.match(/label="Zapsat stejné"/g) ?? []).toHaveLength(2);
    expect(text.match(/accessibilityLabel\('Zapsat stejné pivo'\)/g) ?? []).toHaveLength(2);
    expect(text).not.toContain('Přidat další');
    expect(text).not.toContain('Přidat stejné pivo');
  });

  it('Android BeerLiveActivityNotification uses Zapsat stejné pivo and no retired copy', () => {
    const text = read(
      'modules',
      'beer-live-activity',
      'android',
      'src',
      'main',
      'java',
      'com',
      'napivo',
      'beerliveactivity',
      'BeerLiveActivityNotification.kt',
    );
    expect(text).toContain('"Zapsat stejné pivo"');
    expect(text).not.toContain('Přidat další');
  });
});

describe('release policy: LiveParty GPS wiring', () => {
  const liveParty = read('src', 'party', 'LivePartyMockScreen.tsx');

  it('takes its map fallback position from useNearbyPub instead of a second GPS watcher', () => {
    expect(liveParty).not.toContain('useDevicePosition');
    expect(squash(liveParty)).toMatch(/fallbackCenter=\{\s*nearby\.position\s*\?\?\s*undefined\s*\}/);
  });

  it('gates its useNightRecord polling on route focus', () => {
    expect(liveParty).toMatch(/useNightRecord\(\{\s*pollingEnabled:\s*isFocused\s*\}\)/);
  });
});

describe('release policy: LeaderboardsScreen categories', () => {
  const text = read('src', 'leaderboards', 'LeaderboardsScreen.tsx');
  const flat = squash(text);

  it('declares only pubs and mapper categories', () => {
    const declaration = flat.match(/CATEGORIES[^=]*=\s*\[\s*([^\]]*?)\s*\]/);
    expect(declaration).not.toBeNull();
    const entries = declaration![1]
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(entries.sort()).toEqual(['mapper', 'pubs']);
  });

  it('defaults useState to pubs', () => {
    expect(flat).toMatch(/useState<\s*LeaderboardCategory\s*>\(\s*'pubs'\s*\)/);
  });

  it('contains no beers category literal', () => {
    expect(flat).not.toMatch(/\bbeers\b/);
  });
});
