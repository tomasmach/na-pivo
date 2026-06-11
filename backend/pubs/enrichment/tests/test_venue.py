"""
Tests for pubs.enrichment.venue.classify_venue.

The live-verified examples in the docstrings below are the ground truth for the
draft-beer classifier, including the gotchas:
  * the generic 'pivo' tag is NOT a draft-beer signal (a sushi bistro has it);
  * 'Restaurace' alone is indecisive ('maybe'), not a pub;
  * tags have poor recall, so a clear pub CATEGORY alone suffices.
"""

from __future__ import annotations

from pubs.enrichment.venue import (
    MAYBE,
    NOT_PUB,
    PUB,
    UNKNOWN,
    classify_venue,
)


class TestPubVerdicts:
    def test_u_fleku_category_and_draft_tag(self):
        """U Fleků: staročeské restaurace + tocene-pivo tag → pub."""
        assert (
            classify_venue(
                ["České a staročeské restaurace", "Restaurace"],
                ["jitrnice", "tocene-pivo", "svickova"],
            )
            == PUB
        )

    def test_village_hospoda_category_only_no_tags(self):
        """Hospůdka na Návsi: ['Hospody a hostince'], no tags → pub."""
        assert classify_venue(["Hospody a hostince"], []) == PUB

    def test_pivnice_u_sadu_category_without_draft_tag(self):
        """Pivnice U Sadu: staročeské restaurace, tocene-pivo tag MISSING → pub
        purely from the category (tags have poor recall)."""
        assert classify_venue(["České a staročeské restaurace", "Restaurace"], []) == PUB

    def test_draft_tag_alone_forces_pub(self):
        """Even a generic category becomes pub when the draft-beer tag is present."""
        assert classify_venue(["Restaurace"], ["tocene-pivo"]) == PUB

    def test_pivovar_substring_covers_minipivovary(self):
        assert classify_venue(["Minipivovary"], []) == PUB
        assert classify_venue(["Pivovary"], []) == PUB

    def test_bary_category(self):
        assert classify_venue(["Bary"], []) == PUB

    def test_pivoteka_category(self):
        assert classify_venue(["Pivotéka"], []) == PUB


class TestNotPubVerdicts:
    def test_bistro_sousedka(self):
        """Bistro Sousedka: ['Restaurace', 'Bistra'], street-food tags → not_pub."""
        assert (
            classify_venue(
                ["Restaurace", "Bistra"],
                ["street-food", "asijske-bistro"],
            )
            == NOT_PUB
        )

    def test_yori_sushi_with_generic_pivo_tag(self):
        """Yori (sushi): many asian categories + the GENERIC 'pivo' tag must NOT
        read as a draft-beer signal → not_pub."""
        assert (
            classify_venue(
                [
                    "Thajské restaurace",
                    "Japonské restaurace",
                    "Vietnamské restaurace",
                    "Čínské restaurace",
                    "Restaurace",
                    "Restaurační a pohostinské služby",
                    "Veganské a vegetariánské restaurace",
                    "Bistra",
                ],
                ["sushi", "pivo", "ramen"],
            )
            == NOT_PUB
        )

    def test_generic_pivo_tag_is_not_a_pub_signal(self):
        """A bare 'pivo' tag on an otherwise non-pub category stays not_pub."""
        assert classify_venue(["Kavárny"], ["pivo"]) == NOT_PUB

    def test_cafe(self):
        assert classify_venue(["Kavárny"], []) == NOT_PUB

    def test_pizzeria(self):
        assert classify_venue(["Pizzerie"], []) == NOT_PUB

    def test_winebar(self):
        assert classify_venue(["Vinárny"], []) == NOT_PUB


class TestIndecisiveVerdicts:
    def test_bare_restaurace_is_maybe(self):
        """'Restaurace' alone is a generic parent → maybe, not pub/not_pub."""
        assert classify_venue(["Restaurace"], []) == MAYBE

    def test_generic_parent_categories_are_maybe(self):
        assert classify_venue(["Restaurační a pohostinské služby"], []) == MAYBE

    def test_unrelated_category_is_maybe(self):
        assert classify_venue(["Penziony"], []) == MAYBE

    def test_empty_categories_is_unknown(self):
        assert classify_venue([], []) == UNKNOWN

    def test_empty_categories_with_tags_is_unknown(self):
        """No categories at all → unknown, even if irrelevant tags exist."""
        assert classify_venue([], ["jitrnice"]) == UNKNOWN


class TestNormalization:
    def test_diacritics_and_case_insensitive(self):
        # Upper-case + diacritics must still match the pub set.
        assert classify_venue(["HOSPODY A HOSTINCE"], []) == PUB
        assert classify_venue(["Pivnice"], []) == PUB

    def test_pub_signal_takes_precedence_over_not_pub(self):
        """A place tagged both pub-ish and bistro-ish resolves to pub (rule order)."""
        assert classify_venue(["Bistra"], ["tocene-pivo"]) == PUB
        assert classify_venue(["Pivnice", "Bistra"], []) == PUB
