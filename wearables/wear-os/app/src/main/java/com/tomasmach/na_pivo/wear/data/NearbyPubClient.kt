package com.tomasmach.na_pivo.wear.data

import com.tomasmach.na_pivo.wear.BuildConfig
import com.tomasmach.na_pivo.wear.domain.GeoReading
import com.tomasmach.na_pivo.wear.domain.PubRef
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.round
import kotlin.math.sin
import kotlin.math.sqrt
import org.json.JSONObject

sealed interface NearbyResult {
    data class Success(val pubs: List<PubRef>) : NearbyResult
    data object Empty : NearbyResult
    data object Offline : NearbyResult
}

class NearbyPubClient {
    fun fetchNearby(reading: GeoReading): NearbyResult {
        // A coarse request cell is enough for nearby discovery. The observed fix
        // remains in memory and is never written to disk or diagnostic output.
        val coarseLat = round(reading.latitude * 1_000.0) / 1_000.0
        val coarseLng = round(reading.longitude * 1_000.0) / 1_000.0
        val endpoint = URL(
            "${BuildConfig.BACKEND_URL.trimEnd('/')}/v1/pubs/near" +
                "?lat=${decimal(coarseLat)}&lng=${decimal(coarseLng)}&radius_km=3",
        )
        val connection = (endpoint.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 6_000
            readTimeout = 8_000
            setRequestProperty("Accept", "application/json")
            instanceFollowRedirects = false
        }
        return try {
            if (connection.responseCode !in 200..299) return NearbyResult.Offline
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val items = JSONObject(body).optJSONArray("items") ?: return NearbyResult.Empty
            val pubs = buildList {
                for (index in 0 until items.length()) {
                    val item = items.optJSONObject(index) ?: continue
                    val name = item.optString("name").trim()
                    val position = item.optJSONObject("position") ?: continue
                    val lat = position.optDouble("lat", Double.NaN)
                    val lng = position.optDouble("lon", Double.NaN)
                    val details = item.optJSONObject("pubDetails")
                    if (name.isBlank() || !lat.isFinite() || !lng.isFinite()) continue
                    if (details?.optString("venueKind") == "not_pub") continue
                    val externalId = item.optString("id").trim().takeIf { it.isNotBlank() }
                    // The mobile visit/session identity is always the same
                    // geohash-8 cell as the backend. Provider ids are metadata
                    // only and may change between nearby responses.
                    val key = geohash8(lat, lng)
                    val city = item.optJSONArray("regionalStructure")
                        ?.let { regions ->
                            (0 until regions.length())
                                .mapNotNull(regions::optJSONObject)
                                .firstOrNull { region ->
                                    region.optString("type") in setOf("regional.municipality", "municipality")
                                }
                                ?.optString("name")
                        }
                    add(
                        PubRef(
                            pubKey = key.take(64),
                            name = name.take(200),
                            latitude = lat,
                            longitude = lng,
                            city = city?.takeIf { it.isNotBlank() }?.take(128),
                            externalId = externalId?.take(128),
                        ),
                    )
                }
            }
                .distinctBy { it.pubKey }
                .sortedBy { pub ->
                    haversineMeters(coarseLat, coarseLng, pub.latitude, pub.longitude)
                }
                .take(6)
            if (pubs.isEmpty()) NearbyResult.Empty else NearbyResult.Success(pubs)
        } catch (_: Exception) {
            NearbyResult.Offline
        } finally {
            connection.disconnect()
        }
    }

    private fun decimal(value: Double, places: Int = 3): String =
        String.format(Locale.US, "%.${places}f", value)
}

fun haversineMeters(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
    val radiusMeters = 6_371_000.0
    val latDelta = Math.toRadians(bLat - aLat)
    val lngDelta = Math.toRadians(bLng - aLng)
    val a = sin(latDelta / 2) * sin(latDelta / 2) +
        cos(Math.toRadians(aLat)) * cos(Math.toRadians(bLat)) *
        sin(lngDelta / 2) * sin(lngDelta / 2)
    return 2 * radiusMeters * asin(sqrt(a))
}

fun bearingDegrees(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Float {
    val lat1 = Math.toRadians(aLat)
    val lat2 = Math.toRadians(bLat)
    val deltaLng = Math.toRadians(bLng - aLng)
    val y = sin(deltaLng) * cos(lat2)
    val x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(deltaLng)
    return ((Math.toDegrees(kotlin.math.atan2(y, x)) + 360.0) % 360.0).toFloat()
}
