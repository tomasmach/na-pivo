import { cs } from '@/i18n/cs';

const RETIRED_STRINGS = [
  'Připomenout další pivo',
  'Připomenout za',
  'Připsat další',
  'Jo, připsat další pivo',
  'Ještě jedno',
  'PIVNÍ TEMPO',
  'Kde ti to teklo nejvíc',
  'jak rychle',
] as const;

function serializeTargetedValues(): string {
  return JSON.stringify({
    reminderTitle: cs.settings.beerCountReminder.title,
    reminderSubtitle: cs.settings.beerCountReminder.subtitle,
    interval15: cs.settings.beerCountReminder.intervalOption(15),
    counterRepeatRadegast: cs.a11y.counterRepeat('Radegast'),
    counterRapidConfirm: cs.a11y.counterRapidConfirm,
    oneMoreTag: cs.beerCheckins.tags.one_more,
    statsEmptyBody: cs.stats.emptyBody,
    statsPeriodsHeader: cs.stats.periodsHeader,
    statsPubsSubtitle: cs.stats.pubsSubtitle,
    profileHistoryFactsHeader: cs.profile.historyFactsHeader,
  });
}

describe('alcohol safety copy', () => {
  it('uses the diary-checkup reminder framing', () => {
    expect(cs.settings.beerCountReminder.title).toBe('Kontrola deníčku');
    expect(cs.settings.beerCountReminder.subtitle).toBe(
      'Po zápisu nastavím jednu upomínku ke kontrole deníčku. Sama se neopakuje.',
    );
    expect(cs.settings.beerCountReminder.intervalOption(15)).toBe('Zkontrolovat deníček za 15 minut');
  });

  it('keeps the a11y copy for repeating and confirming beers exact', () => {
    expect(cs.a11y.counterRepeat('Radegast')).toBe('Zapsat stejné pivo: Radegast');
    expect(cs.a11y.counterRapidConfirm).toBe('Ano, zapsat');
  });

  it('labels the one_more verdict tag as Chutnalo mi', () => {
    expect(cs.beerCheckins.tags.one_more).toBe('Chutnalo mi');
  });

  it('keeps the stats and profile copy exact', () => {
    expect(cs.stats.emptyBody).toBe('Až si zapíšeš večer, najdeš tu soukromý přehled.');
    expect(cs.stats.periodsHeader).toBe('PŘEHLED PO OBDOBÍ');
    expect(cs.stats.pubsSubtitle).toBe('Hospody podle počtu zápisů');
    expect(cs.profile.historyFactsHeader).toBe('Údaje večerů');
  });

  it('drops retired alcohol-tempo strings from the targeted keys', () => {
    const serialized = serializeTargetedValues();
    for (const retired of RETIRED_STRINGS) {
      expect(serialized).not.toContain(retired);
    }
  });
});
