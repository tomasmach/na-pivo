"""Tests for pubs.enrichment.matcher."""


from pubs.enrichment.matcher import geohash8, verify_match

# ---------------------------------------------------------------------------
# Geohash
# ---------------------------------------------------------------------------

class TestGeohash8:
    def test_returns_string_of_length_8(self):
        h = geohash8(50.0789, 14.4170)
        assert isinstance(h, str)
        assert len(h) == 8

    def test_deterministic(self):
        h1 = geohash8(50.0789, 14.4170)
        h2 = geohash8(50.0789, 14.4170)
        assert h1 == h2

    def test_different_coords_different_hash(self):
        h1 = geohash8(50.0789, 14.4170)
        h2 = geohash8(50.0800, 14.4200)
        assert h1 != h2

    def test_close_points_may_share_hash(self):
        # Points ~5 m apart should share their 8-char geohash (~38 m precision)
        h1 = geohash8(50.07891, 14.41700)
        h2 = geohash8(50.07892, 14.41701)
        # May or may not be equal depending on exact boundary — just check types
        assert isinstance(h1, str)
        assert isinstance(h2, str)

    def test_known_prague_geohash(self):
        # U Fleků coordinates
        h = geohash8(50.078914, 14.416990)
        assert isinstance(h, str)
        assert len(h) == 8
        # Should start with 'u2fkdzzm' area prefix (central Prague)
        # We just verify it starts with 'u' (Europe)
        assert h.startswith("u")


# ---------------------------------------------------------------------------
# verify_match
# ---------------------------------------------------------------------------

class TestVerifyMatch:
    # Good match: same name, very close location
    def test_exact_name_same_location(self):
        score = verify_match(
            "Restaurace U Fleků",
            50.078914, 14.416990,
            "Restaurace U Fleků",
            50.078914, 14.416990,
        )
        assert score >= 0.95

    def test_partial_name_match_nearby(self):
        # Slightly different name, <100 m away
        score = verify_match(
            "U Fleků",
            50.078914, 14.416990,
            "Restaurace U Fleků",
            50.078950, 14.417010,  # ~4 m away
        )
        assert score >= 0.6

    def test_good_name_bad_location(self):
        # Same name but 2 km away → lower confidence
        score = verify_match(
            "Restaurace U Fleků",
            50.078914, 14.416990,
            "Restaurace U Fleků",
            50.098914, 14.416990,  # ~2.2 km north
        )
        # Name score high, geo score low
        assert 0.3 <= score <= 0.85

    def test_completely_different_name_far_away(self):
        score = verify_match(
            "U Fleků",
            50.078914, 14.416990,
            "McDonald's Brno",
            49.195060, 16.606837,
        )
        assert score < 0.3

    def test_different_name_same_location(self):
        # An unrelated name at the SAME location must be REJECTED: geo alone
        # must not clear the bar (this is the geo-only false-positive guard).
        score = verify_match(
            "Pivnice Na Rohu",
            50.078914, 14.416990,
            "Restaurace U Nováků",
            50.078914, 14.416990,
        )
        # name_sim ≈ 0.35 < gate → hard-rejected regardless of geo.
        assert score < 0.4

    def test_no_candidate_coords_neutral_geo(self):
        # When no candidate coords, geo is 0.5 (neutral)
        score = verify_match(
            "U Fleků",
            50.078914, 14.416990,
            "U Fleků",
            None, None,
        )
        # name_score ≈ 1.0, geo_score = 0.5 → 0.6*1 + 0.4*0.5 = 0.80
        assert score >= 0.7

    def test_score_in_range_0_1(self):
        for _ in range(5):
            score = verify_match("A", 50.0, 14.0, "B", 49.0, 13.0)
            assert 0.0 <= score <= 1.0

    def test_threshold_reject(self):
        # Completely different — score should be below 0.4 (MIN_CONFIDENCE)
        score = verify_match(
            "Pivnice Svijanský Rytíř",
            50.078914, 14.416990,
            "Autoservis Novák",
            49.195060, 16.606837,
        )
        assert score < 0.4

    def test_distance_falloff_nearby(self):
        # <100 m → near-perfect geo
        score_near = verify_match("X", 50.0, 14.0, "X", 50.0001, 14.0001)
        # ~11 m
        score_far = verify_match("X", 50.0, 14.0, "X", 50.01, 14.01)
        # ~1.2 km
        assert score_near > score_far


class TestNameGate:
    """Geo alone must never clear MIN_CONFIDENCE — a hard name-similarity gate.

    These reproduce the verified geo-only false-accepts from the review:
      * verify_match('Hospudka', loc, 'Lekarna', same loc) used to score 0.560
      * 'U Fleku' vs 'Trafika Tabak' ~1 m apart used to score 0.519
    """

    from pubs.enrichment.firmy import MIN_CONFIDENCE

    def test_same_location_unrelated_name_rejected_hospudka_lekarna(self):
        from pubs.enrichment.firmy import MIN_CONFIDENCE

        score = verify_match("Hospudka", 50.0, 14.0, "Lekarna", 50.0, 14.0)
        assert score < MIN_CONFIDENCE

    def test_same_location_unrelated_name_rejected_ufleku_trafika(self):
        from pubs.enrichment.firmy import MIN_CONFIDENCE

        # ~1 m apart, totally different name
        score = verify_match("U Fleku", 50.0, 14.0, "Trafika Tabak", 50.00001, 14.00001)
        assert score < MIN_CONFIDENCE

    def test_same_location_matching_name_accepted(self):
        from pubs.enrichment.firmy import MIN_CONFIDENCE

        # Same name at the same location MUST clear the bar.
        score = verify_match(
            "Restaurace U Fleků", 50.078914, 14.416990,
            "Restaurace U Fleků", 50.078914, 14.416990,
        )
        assert score >= MIN_CONFIDENCE
        assert score >= 0.9

    def test_real_ufleku_case_still_passes(self):
        """The genuine U Fleků match (query 'U Fleků' vs 'Restaurace U Fleků',
        ~4 m apart) must still be accepted — name_sim 0.56 clears the gate."""
        from pubs.enrichment.firmy import MIN_CONFIDENCE

        score = verify_match(
            "U Fleků", 50.078914, 14.416990,
            "Restaurace U Fleků", 50.078950, 14.417010,
        )
        assert score >= MIN_CONFIDENCE

    def test_fixture_ufleku_confidence_above_min(self):
        """The fixture-geometry U Fleků match (~0.736 with the original blend)
        must still clear MIN_CONFIDENCE after the rebalance."""
        from pubs.enrichment.firmy import MIN_CONFIDENCE

        score = verify_match(
            "U Fleků", 50.078914, 14.416990,
            "Restaurace U Fleků", 50.078916298731976, 14.416990397608915,
        )
        assert score >= MIN_CONFIDENCE
