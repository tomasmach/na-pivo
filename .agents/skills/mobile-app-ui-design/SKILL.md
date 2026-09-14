---
name: mobile-app-ui-design
description: Navrhni nebo uprav mobilní UI Na pivo podle projektového DESIGN.md a schválených mocků.
---

# Mobilní UI Na pivo

Před návrhem přečti relevantní části [DESIGN.md](../../../DESIGN.md): etalon 3.0, tokeny a pravidla dotčené komponenty. Číselné hodnoty kopíruj z dokumentu a existujících tokenů; obecný mobilní styl je nepřepisuje. Spacing zahrnuje i 14; nové glow ani CardSheen do UI nepatří.

Použij existující vzory v `src/mocks/mockTheme.ts`, `src/theme/` a `src/components/shared/`. Zachovej safe area, klávesnici, čitelnost textu a dostupnost ovládání na dotčené platformě. UI copy patří současně do české i anglické lokalizace podle AGENTS.md.

Pro netriviální nový návrh ukaž statické varianty A/B/C vedle sebe a počkej na výběr. Schválený mock implementuj bez dalšího schvalovacího kola; kosmetika varianty nepotřebuje. Rozpor mocku s DESIGN.md pojmenuj a vyřeš podle projektových pravidel, nevymýšlej lokální výjimku.

Výsledek ověř ve skutečném mobilním flow a prohlédni screenshot; schválený mock porovnej ve stejném stavu. Pro spuštění prostředí použij [run-na-pivo](../run-na-pivo/SKILL.md). Staré obecné reference v této složce nejsou autoritou pro vzhled Na pivo.
