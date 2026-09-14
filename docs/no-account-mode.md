# Verze bez přihlášení

Produktové rozhodnutí (majitel, tato session). Zapsáno, aby se nemuselo
odvozovat z kódu.

## Pravidlo

Bez účtu je app **plnohodnotná k prohlížení a k vlastnímu zápisu, ale mlčí
navenek**. Nemůžeš nic poslat druhým lidem a nic o tobě neopustí telefon.

| Oblast | Bez účtu |
|---|---|
| Kocoviny (feed) | **vidí** |
| Reakce, cheers, komentáře | **ne** |
| Hospody, detail, mapa | **vidí** |
| Komunita, žebříčky, výzvy | **vidí** |
| Profil | místo obsahu **CTA** |
| Vlastní tracking piv a večerů | **ne** — místo něj „track your progress" |
| Ukládání k přezdívce | **ano**, lokálně |
| Sdílení čehokoliv | **ne** |
| Zvaní lidí do hubu | **ne** |

## Jak to má vypadat, ne jak to má být zakázané

Zamčenou funkci **nezobrazuj jako chybu**. Ta hranice je nabídka, ne zeď: člověk
bez účtu má vidět, co by měl, kdyby účet měl — proto vidí feed i komunitu.

- Reakce zůstávají na obrazovce, ale ťuknutí otevře přihlášení. Ne šedivé,
  neschované — jinak nedává smysl, proč tam jsou.
- Profil bez účtu **není prázdný profil**. Je to jedna nabídka: „track your
  progress". Nezobrazovat nuly, protože nula je výsledek, a tohle není výsledek.
- Přezdívka bez účtu je lokální jméno pro vlastní záznamy. **Nesmí** se nikam
  odeslat a nesmí vypadat jako profil, který někdo uvidí.

## Co to znamená technicky

Backend je dnes device-based, takže „bez přihlášení" už částečně existuje. Práce
není v zakazování, ale v tom, aby:

1. existoval jeden zdroj pravdy `canPublish` / `canReact` / `canInvite`, ne
   patnáct `if (session)` po obrazovkách;
2. lokální záznamy u přezdívky měly **cestu k převzetí** — když se člověk později
   přihlásí, jeho piva se musí připojit k účtu, ne zmizet. To je ta část, kterou
   je snadné odložit a pak už nejde dodělat.

**Otevřené:** co se stane s lokálními daty, když se přihlásí na účet, který už
nějaká má. Sloučit, nebo nechat vybrat? Sloučení bez zeptání je ztráta dat, na
kterou se přijde pozdě.
