"""Tests for pubs.enrichment.normalizer."""


from pubs.enrichment.normalizer import normalize_to_osm


class TestNormalizeToOsmStrings:
    """Input: plain strings."""

    def test_already_normalized_string(self):
        assert normalize_to_osm("Mo-Fr 09:00-17:00") == "Mo-Fr 09:00-17:00"

    def test_en_dash_replaced(self):
        # en dash U+2013
        result = normalize_to_osm("Mo,Tu,We,Th,Fr,Sa,Su 10:00–23:00")
        assert result == "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

    def test_em_dash_replaced(self):
        # em dash U+2014
        result = normalize_to_osm("Mo-Fr 08:00—16:00")
        assert result == "Mo-Fr 08:00-16:00"

    def test_minus_sign_replaced(self):
        # minus sign U+2212
        result = normalize_to_osm("Sa,Su 11:00−20:00")
        assert result == "Sa,Su 11:00-20:00"

    def test_ufleku_real_example(self):
        raw = "Mo,Tu,We,Th,Fr,Sa,Su 10:00–23:00"
        assert normalize_to_osm(raw) == "Mo,Tu,We,Th,Fr,Sa,Su 10:00-23:00"

    def test_24_7(self):
        assert normalize_to_osm("24/7") == "24/7"

    def test_empty_string_returns_none(self):
        assert normalize_to_osm("") is None

    def test_whitespace_only_returns_none(self):
        assert normalize_to_osm("   ") is None

    def test_none_returns_none(self):
        assert normalize_to_osm(None) is None


class TestNormalizeToOsmLists:
    """Input: list of strings."""

    def test_list_of_strings_joined(self):
        result = normalize_to_osm(["Mo-Fr 08:00-18:00", "Sa 09:00-13:00"])
        assert result == "Mo-Fr 08:00-18:00; Sa 09:00-13:00"

    def test_list_with_en_dashes(self):
        raw = [
            "Mo,Tu,We,Th,Fr 09:00–17:00",
            "Sa 10:00–14:00",
        ]
        assert normalize_to_osm(raw) == "Mo,Tu,We,Th,Fr 09:00-17:00; Sa 10:00-14:00"

    def test_single_item_list(self):
        result = normalize_to_osm(["Mo-Su 10:00-22:00"])
        assert result == "Mo-Su 10:00-22:00"

    def test_empty_list_returns_none(self):
        assert normalize_to_osm([]) is None

    def test_list_with_empty_strings_filtered(self):
        result = normalize_to_osm(["Mo-Fr 08:00-18:00", "", "Sa 10:00-14:00"])
        assert result == "Mo-Fr 08:00-18:00; Sa 10:00-14:00"


class TestNormalizeToOsmSpecification:
    """Input: openingHoursSpecification list of dicts."""

    def test_simple_spec(self):
        spec = [
            {
                "@type": "OpeningHoursSpecification",
                "dayOfWeek": "http://schema.org/Monday",
                "opens": "09:00",
                "closes": "17:00",
            }
        ]
        result = normalize_to_osm(spec)
        assert result == "Mo 09:00-17:00"

    def test_multiple_specs(self):
        spec = [
            {
                "dayOfWeek": "http://schema.org/Monday",
                "opens": "09:00",
                "closes": "17:00",
            },
            {
                "dayOfWeek": "http://schema.org/Saturday",
                "opens": "10:00",
                "closes": "14:00",
            },
        ]
        result = normalize_to_osm(spec)
        assert result == "Mo 09:00-17:00; Sa 10:00-14:00"

    def test_spec_with_list_of_days(self):
        spec = [
            {
                "dayOfWeek": [
                    "http://schema.org/Monday",
                    "http://schema.org/Tuesday",
                    "http://schema.org/Wednesday",
                ],
                "opens": "08:00",
                "closes": "20:00",
            }
        ]
        result = normalize_to_osm(spec)
        assert result == "Mo,Tu,We 08:00-20:00"

    def test_spec_with_seconds_trimmed(self):
        spec = [
            {
                "dayOfWeek": "http://schema.org/Friday",
                "opens": "10:00:00",
                "closes": "22:00:00",
            }
        ]
        result = normalize_to_osm(spec)
        assert result == "Fr 10:00-22:00"

    def test_spec_full_week_all_days(self):
        days = [
            "http://schema.org/Monday",
            "http://schema.org/Tuesday",
            "http://schema.org/Wednesday",
            "http://schema.org/Thursday",
            "http://schema.org/Friday",
            "http://schema.org/Saturday",
            "http://schema.org/Sunday",
        ]
        spec = [{"dayOfWeek": d, "opens": "10:00", "closes": "23:00"} for d in days]
        result = normalize_to_osm(spec)
        assert result == "Mo 10:00-23:00; Tu 10:00-23:00; We 10:00-23:00; Th 10:00-23:00; Fr 10:00-23:00; Sa 10:00-23:00; Su 10:00-23:00"

    def test_spec_https_schema_org(self):
        spec = [
            {
                "dayOfWeek": "https://schema.org/Sunday",
                "opens": "11:00",
                "closes": "16:00",
            }
        ]
        result = normalize_to_osm(spec)
        assert result == "Su 11:00-16:00"

    def test_empty_spec_list_returns_none(self):
        assert normalize_to_osm([]) is None

    def test_spec_opens_equals_closes_emitted_faithfully(self):
        """opens == closes is NOT treated as a 'closed' marker.

        Verified against live Firmy.cz data: Firmy never emits
        openingHoursSpecification at all (it uses the string/list openingHours
        form), and a closed day is conveyed by OMITTING the day — never by
        opens==closes. An earlier assumption that opens==closes meant 'closed'
        was wrong: the evaluator reads '00:00-00:00' as open-24h, so guessing
        'closed' here would invert genuine nonstop venues. This defensive branch
        therefore emits hours faithfully without editorialising.
        """
        spec = [
            {"dayOfWeek": "http://schema.org/Monday", "opens": "10:00", "closes": "22:00"},
            {"dayOfWeek": "http://schema.org/Sunday", "opens": "00:00", "closes": "00:00"},
        ]
        result = normalize_to_osm(spec)
        assert result == "Mo 10:00-22:00; Su 00:00-00:00"

    def test_spec_missing_opens_closes_graceful(self):
        """opens/closes absent or None must not raise and must not emit a range."""
        spec = [
            {"dayOfWeek": "http://schema.org/Monday"},
            {"dayOfWeek": "http://schema.org/Tuesday", "opens": None, "closes": None},
        ]
        result = normalize_to_osm(spec)
        # No crash; no spurious open-range tokens.
        assert result is None or "-" not in result

    def test_czech_day_abbreviations(self):
        """A Czech site may emit dayOfWeek='Po'/'Út'/etc. — these must map.

        Sunday is simply omitted here, which is how a closed day is conveyed;
        Firmy never uses opens==closes for that.
        """
        spec = [
            {"dayOfWeek": "Po", "opens": "10:00", "closes": "22:00"},
            {"dayOfWeek": "Út", "opens": "10:00", "closes": "22:00"},
            {"dayOfWeek": "St", "opens": "10:00", "closes": "22:00"},
            {"dayOfWeek": "Čt", "opens": "10:00", "closes": "22:00"},
            {"dayOfWeek": "Pá", "opens": "10:00", "closes": "22:00"},
            {"dayOfWeek": "So", "opens": "11:00", "closes": "23:00"},
        ]
        result = normalize_to_osm(spec)
        assert result == (
            "Mo 10:00-22:00; Tu 10:00-22:00; We 10:00-22:00; "
            "Th 10:00-22:00; Fr 10:00-22:00; Sa 11:00-23:00"
        )

    def test_czech_day_ascii_fallbacks(self):
        """ASCII fallbacks (Ut/Ct/Pa) for the accented Czech abbreviations map too."""
        spec = [
            {"dayOfWeek": "Ut", "opens": "09:00", "closes": "17:00"},
            {"dayOfWeek": "Ct", "opens": "09:00", "closes": "17:00"},
            {"dayOfWeek": "Pa", "opens": "09:00", "closes": "17:00"},
        ]
        result = normalize_to_osm(spec)
        assert result == "Tu 09:00-17:00; Th 09:00-17:00; Fr 09:00-17:00"

    def test_unmappable_day_logs_warning(self, caplog):
        """An unknown dayOfWeek token logs a warning and is skipped (not silent)."""
        import logging

        spec = [{"dayOfWeek": "Funday", "opens": "10:00", "closes": "22:00"}]
        with caplog.at_level(logging.WARNING):
            result = normalize_to_osm(spec)
        assert result is None
        assert any("Funday" in rec.message for rec in caplog.records)
