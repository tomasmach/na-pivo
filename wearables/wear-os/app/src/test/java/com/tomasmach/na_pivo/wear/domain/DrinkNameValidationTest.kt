package com.tomasmach.na_pivo.wear.domain

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DrinkNameValidationTest {
    @Test
    fun `rejects every canonical generic drink name`() {
        listOf(
            "beer",
            "drink",
            "napoj",
            "nealko",
            "neco",
            "něco",
            "nápoj",
            "panak",
            "panák",
            "pivo",
            "shot",
            "vino",
            "víno",
        ).forEach { name ->
            assertFalse(name, isConcreteDrinkName(name))
            assertFalse(name.uppercase(), isConcreteDrinkName("  ${name.uppercase()}  "))
        }
    }

    @Test
    fun `accepts only nonblank names up to eighty characters`() {
        assertTrue(isConcreteDrinkName("Pilsner Urquell 12°"))
        assertTrue(isConcreteDrinkName("x".repeat(80)))
        assertFalse(isConcreteDrinkName(" \n\t "))
        assertFalse(isConcreteDrinkName("x".repeat(81)))
    }
}
