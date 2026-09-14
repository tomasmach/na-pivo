import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const readSource = (...segments: string[]): string =>
  readFileSync(path.join(ROOT, ...segments), 'utf8');

describe('core mobile release layout contracts', () => {
  it('keeps both pub-list scroll surfaces above the absolute tab bar', () => {
    const source = readSource('src', 'pubs', 'PubListMockScreen.tsx');

    expect(source).not.toContain('insets.bottom + 120');
    expect(source.match(/insets\.bottom \+ TAB_CHROME/g)).toHaveLength(2);
  });

  it('gives loaded and skeleton feed cards one full-bleed expansion with 20 pt inner alignment', () => {
    const source = readSource('src', 'feed', 'FeedScreen.tsx');
    const cardStyle = source.match(/card: \{([\s\S]*?)\n  \}/)?.[1] ?? '';
    const skeletonListStyle = source.match(/skeletonList: \{([\s\S]*?)\}/)?.[1] ?? '';

    expect(source.match(/marginHorizontal: -MockLayout\.screenPad/g)).toHaveLength(1);
    expect(cardStyle).toContain('marginHorizontal: -MockLayout.screenPad');
    expect(cardStyle).toContain('paddingHorizontal: MockLayout.screenPad');
    expect(skeletonListStyle).not.toContain('marginHorizontal');
  });

  it.each([
    ['src/feed/FeedScreen.tsx', 'wordmark'],
    ['src/feed/FeedScreen.tsx', 'factValue'],
    ['src/mocks/StatGrid.tsx', 'value'],
    ['src/community/ChallengeDetailScreen.tsx', 'count'],
  ])('disables Android font padding for %s numeral style %s', (file, styleName) => {
    const source = readSource(...file.split('/'));
    const style = source.match(new RegExp(`${styleName}: \\{([\\s\\S]*?)\\n  \\}`));

    expect(style?.[1]).toContain('fontFamily: Fonts.numeral');
    expect(style?.[1]).toContain('includeFontPadding: false');
  });
});
