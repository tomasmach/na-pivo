package com.tomasmach.na_pivo.wear.data

/**
 * Standard longitude-first geohash encoder. This intentionally mirrors
 * src/data/geohash.ts and the backend's geohash2 encoder bit for bit.
 */
fun geohash8(latitude: Double, longitude: Double): String {
    require(latitude in -90.0..90.0)
    require(longitude in -180.0..180.0)

    var latitudeMin = -90.0
    var latitudeMax = 90.0
    var longitudeMin = -180.0
    var longitudeMax = 180.0
    var longitudeBit = true
    var bit = 0
    var character = 0
    val result = StringBuilder(8)

    while (result.length < 8) {
        if (longitudeBit) {
            val midpoint = (longitudeMin + longitudeMax) / 2.0
            if (longitude > midpoint) {
                character = (character shl 1) or 1
                longitudeMin = midpoint
            } else {
                character = character shl 1
                longitudeMax = midpoint
            }
        } else {
            val midpoint = (latitudeMin + latitudeMax) / 2.0
            if (latitude > midpoint) {
                character = (character shl 1) or 1
                latitudeMin = midpoint
            } else {
                character = character shl 1
                latitudeMax = midpoint
            }
        }
        longitudeBit = !longitudeBit
        bit += 1

        if (bit == 5) {
            result.append(BASE32[character])
            bit = 0
            character = 0
        }
    }
    return result.toString()
}

private const val BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
