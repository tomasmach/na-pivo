package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.domain.DrinkType
import com.tomasmach.na_pivo.wear.domain.PersistedState
import com.tomasmach.na_pivo.wear.domain.validVolume
import java.io.File
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContractFixtureTest {
    @Test
    fun `decodes canonical state snapshot`() {
        val bytes = fixture("state-snapshot.v1.json").readBytes()
        val snapshot = JsonCodec.decodeSnapshot(bytes)

        assertEquals("u2fkbn4f", snapshot.target?.pub?.pubKey)
        assertEquals("Pilsner Urquell 12°", snapshot.activeEvening?.lastDrink?.name)
        assertEquals(68, snapshot.activeEvening?.totalCzk)
        assertEquals("Kozel 11°", snapshot.menuDrinks.single().name)
        assertEquals(null, snapshot.menuDrinks.single().priceCzk)
    }

    @Test
    fun `encodes canonical custom 450 ml beer command`() {
        val fixture = JSONObject(fixture("custom-beer-command.v1.json").readText())
        val state = PersistedState(
            actorId = fixture.getString("actorId"),
            accountEpoch = fixture.getString("accountEpoch"),
            revision = fixture.getLong("baseRevision"),
            initialized = true,
        )
        val encoded = JSONObject(
            JsonCodec.commandEnvelope(
                state = state,
                messageId = fixture.getString("messageId"),
                sequence = fixture.getLong("actorSequence"),
                sentAt = fixture.getString("sentAt"),
                command = fixture.getJSONObject("payload").getJSONObject("command"),
            ),
        )

        assertEquals(fixture.getInt("protocolVersion"), encoded.getInt("protocolVersion"))
        assertEquals(fixture.getString("messageId"), encoded.getString("messageId"))
        assertEquals(fixture.getString("accountEpoch"), encoded.getString("accountEpoch"))
        assertEquals(fixture.getString("actorId"), encoded.getString("actorId"))
        assertEquals("wearos", encoded.getString("actorKind"))
        assertEquals(fixture.getLong("actorSequence"), encoded.getLong("actorSequence"))
        assertEquals(fixture.getLong("baseRevision"), encoded.getLong("baseRevision"))
        assertEquals(fixture.getString("sentAt"), encoded.getString("sentAt"))
        assertEquals("command", encoded.getString("kind"))
        assertEquals(
            fixture.getJSONObject("payload").getJSONObject("command").toString(),
            encoded.getJSONObject("payload").getJSONObject("command").toString(),
        )
        assertTrue(validVolume(DrinkType.BEER, 450))
    }

    private fun fixture(name: String): File {
        val candidates = listOf(
            File("../shared/fixtures/$name"),
            File("../../shared/fixtures/$name"),
            File("wearables/shared/fixtures/$name"),
        )
        return candidates.firstOrNull(File::isFile)
            ?: error("Missing shared contract fixture $name from ${File(".").absolutePath}")
    }
}
