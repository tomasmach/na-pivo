package com.tomasmach.na_pivo.wear.sensors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.tomasmach.na_pivo.wear.domain.GeoReading
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class LocationHeadingController(context: Context) : SensorEventListener, LocationListener {
    private val appContext = context.applicationContext
    private val locationManager = appContext.getSystemService(LocationManager::class.java)
    private val sensorManager = appContext.getSystemService(SensorManager::class.java)
    private val rotationSensor =
        sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            ?: sensorManager.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)

    private val mutableLocation = MutableStateFlow<GeoReading?>(null)
    val location: StateFlow<GeoReading?> = mutableLocation

    private val mutableHeading = MutableStateFlow<Float?>(null)
    val heading: StateFlow<Float?> = mutableHeading

    fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            appContext,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                appContext,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED

    fun start() {
        if (rotationSensor != null) {
            sensorManager.registerListener(
                this,
                rotationSensor,
                SensorManager.SENSOR_DELAY_UI,
            )
        }
        if (!hasLocationPermission()) return
        try {
            val providers = buildList {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    add(LocationManager.FUSED_PROVIDER)
                }
                add(LocationManager.GPS_PROVIDER)
                add(LocationManager.NETWORK_PROVIDER)
            }.filter { provider ->
                runCatching { locationManager.isProviderEnabled(provider) }.getOrDefault(false)
            }
            providers.forEach { provider ->
                locationManager.getLastKnownLocation(provider)?.let(::acceptLocation)
                locationManager.requestLocationUpdates(provider, 3_000L, 5f, this)
            }
        } catch (_: SecurityException) {
            mutableLocation.value = null
        }
    }

    fun stop() {
        sensorManager.unregisterListener(this)
        runCatching { locationManager.removeUpdates(this) }
    }

    fun injectForDebug(location: GeoReading?, heading: Float?) {
        mutableLocation.value = location
        mutableHeading.value = heading
    }

    override fun onLocationChanged(location: Location) = acceptLocation(location)

    private fun acceptLocation(location: Location) {
        if (!location.latitude.isFinite() || !location.longitude.isFinite()) return
        mutableLocation.value = GeoReading(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = location.accuracy,
        )
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR &&
            event.sensor.type != Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR
        ) return
        val rotation = FloatArray(9)
        val orientation = FloatArray(3)
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        SensorManager.getOrientation(rotation, orientation)
        mutableHeading.value =
            ((Math.toDegrees(orientation[0].toDouble()) + 360.0) % 360.0).toFloat()
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
