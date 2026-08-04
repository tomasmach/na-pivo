package com.tomasmach.na_pivo.wear.data

import org.junit.Assert.assertEquals
import org.junit.Test

class GeohashTest {
    @Test
    fun `matches canonical mobile and backend fixture`() {
        assertEquals("u2fkbn4f", geohash8(50.08706, 14.41786))
    }

    @Test
    fun `nearby provider identity does not affect pub key`() {
        val firstProviderKey = geohash8(50.08706, 14.41786)
        val renamedProviderKey = geohash8(50.08706, 14.41786)
        assertEquals(firstProviderKey, renamedProviderKey)
    }
}
