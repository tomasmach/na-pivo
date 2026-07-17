export interface AccountAchievements {
  firstTen: boolean;
  regular: boolean;
  reviewer: boolean;
  /** Mapér badges (spec §5.3) — additive; absent on older backends → false. */
  firstMap: boolean;
  explorer: boolean;
  cartographer: boolean;
  completionist: boolean;
  factMachine: boolean;
  /** Diary/social badges (leaderboards wave) — additive; absent → false. */
  firstBeer: boolean;
  century: boolean;
  pilgrim: boolean;
  stamgast: boolean;
  nightOwl: boolean;
  taster: boolean;
  partyAnimal: boolean;
  /** "FotoPivař" — won a biweekly photo-contest round. Server-only; additive,
   *  absent on older backends → false. */
  fotoPivar: boolean;
  /** Pivař badges (outside-pub drinking wave) — additive; absent → false. */
  chatar: boolean;
  podSirakem: boolean;
  lahvacovyFilozof: boolean;
  plechovkac: boolean;
}

/** All-locked achievements — the fallback when no server block has arrived. */
export const EMPTY_ACHIEVEMENTS: AccountAchievements = {
  firstTen: false,
  regular: false,
  reviewer: false,
  firstMap: false,
  explorer: false,
  cartographer: false,
  completionist: false,
  factMachine: false,
  firstBeer: false,
  century: false,
  pilgrim: false,
  stamgast: false,
  nightOwl: false,
  taster: false,
  partyAnimal: false,
  fotoPivar: false,
  chatar: false,
  podSirakem: false,
  lahvacovyFilozof: false,
  plechovkac: false,
};

/** Raw snake_case achievements block as sent by the backend. */
export interface RawAchievementsBlock {
  first_ten?: boolean;
  regular?: boolean;
  reviewer?: boolean;
  first_map?: boolean;
  explorer?: boolean;
  cartographer?: boolean;
  completionist?: boolean;
  fact_machine?: boolean;
  first_beer?: boolean;
  century?: boolean;
  pilgrim?: boolean;
  stamgast?: boolean;
  night_owl?: boolean;
  taster?: boolean;
  party_animal?: boolean;
  foto_pivar?: boolean;
  chatar?: boolean;
  pod_sirakem?: boolean;
  lahvacovy_filozof?: boolean;
  plechovkac?: boolean;
}

/** Parse additive achievements while keeping older backend payloads compatible. */
export function parseAchievementsBlock(raw: RawAchievementsBlock): AccountAchievements {
  return {
    firstTen: raw.first_ten === true,
    regular: raw.regular === true,
    reviewer: raw.reviewer === true,
    firstMap: raw.first_map === true,
    explorer: raw.explorer === true,
    cartographer: raw.cartographer === true,
    completionist: raw.completionist === true,
    factMachine: raw.fact_machine === true,
    firstBeer: raw.first_beer === true,
    century: raw.century === true,
    pilgrim: raw.pilgrim === true,
    stamgast: raw.stamgast === true,
    nightOwl: raw.night_owl === true,
    taster: raw.taster === true,
    partyAnimal: raw.party_animal === true,
    fotoPivar: raw.foto_pivar === true,
    chatar: raw.chatar === true,
    podSirakem: raw.pod_sirakem === true,
    lahvacovyFilozof: raw.lahvacovy_filozof === true,
    plechovkac: raw.plechovkac === true,
  };
}
