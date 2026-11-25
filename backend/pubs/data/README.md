# Hranice v `pubs/data`

## `prague_districts.json`

Hranice 22 správních obvodů Prahy (Praha 1–22). Podle nich `pubs/prague_districts.py` určí čtvrť hospody z její polohy.

- Zdroj: ČÚZK, RÚIAN, vrstva „SpravniObvodVHlavnimMestePraze“ (č. 10) prohlížecí služby `https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer`, stav k 7. 11. 2026.
- Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), © Český úřad zeměměřický a katastrální. Podmínky: <https://www.cuzk.gov.cz/Predpisy/Podminky-poskytovani-prostor-dat-a-sitovych-sluzeb/Podminky-poskytovani-prostorovych-dat-CUZK.aspx>.
- Úprava: hranice jsou zjednodušené na 5 m a souřadnice zaokrouhlené na 5 desetinných míst (asi 1 m). Sousední obvody sdílejí stejnou čáru, takže mezi nimi nevznikne mezera ani překryv.

Znovu se data sestaví mimo repo. Mapshaper se spouští jen jednorázově, appka ho za běhu nepotřebuje:

```sh
curl -o raw.geojson "https://ags.cuzk.gov.cz/arcgis/rest/services/RUIAN/Prohlizeci_sluzba_nad_daty_RUIAN/MapServer/10/query?where=1%3D1&outFields=nazev&outSR=4326&f=geojson"
npx -y mapshaper@0.7.101 raw.geojson -rename-fields name=nazev -simplify interval=5 keep-shapes -o precision=0.00001 format=geojson out.json
```

Pak se `out.json` převede do tvaru tohoto souboru: `{"districts": [{"name": "Praha 1", "rings": [[[lng, lat], …]]}]}`, obvody seřazené podle čísla a bez opakovaného posledního bodu kruhu.

## `cz_regions.json`

Kraje pro regionální žebříček piv, viz docstring v `pubs/regions.py`.
