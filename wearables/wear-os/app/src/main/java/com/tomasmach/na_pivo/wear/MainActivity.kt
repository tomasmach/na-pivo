package com.tomasmach.na_pivo.wear

import android.Manifest
import android.app.RemoteInput
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.wear.input.RemoteInputIntentHelper
import com.tomasmach.na_pivo.wear.ui.NaPivoWearApp
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val viewModel: WearViewModel by viewModels()
    private var pendingTextResult: ((String?) -> Unit)? = null
    private var notificationPermissionLaunchInFlight = false

    private val locationPermission = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        viewModel.onLocationPermissionResult(grants.values.any { it })
    }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        notificationPermissionLaunchInFlight = false
        if (granted) {
            viewModel.refreshEveningSurfaces()
        } else {
            viewModel.onNotificationPermissionDenied()
        }
    }

    private val remoteInput = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = pendingTextResult
        pendingTextResult = null
        val value = result.data
            ?.let(RemoteInput::getResultsFromIntent)
            ?.getCharSequence(INPUT_RESULT_KEY)
            ?.toString()
            ?.trim()
            ?.takeIf { it.isNotBlank() }
        callback?.invoke(value)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(R.style.Theme_NaPivoWear)
        setContent {
            NaPivoWearApp(
                viewModel = viewModel,
                requestLocationPermission = ::requestLocationPermission,
                requestNotificationPermission = ::requestNotificationPermission,
                requestTextInput = ::requestTextInput,
            )
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.onForeground()
                try {
                    viewModel.uiState
                        .map { it.activeEvening?.eveningId }
                        .distinctUntilChanged()
                        .collect { activeEveningId ->
                            if (activeEveningId != null) {
                                requestNotificationPermission()
                            }
                        }
                } finally {
                    viewModel.onBackground()
                }
            }
        }

        if (!viewModel.hasLocationPermission()) {
            requestLocationPermission()
        }
    }

    private fun requestLocationPermission() {
        locationPermission.launch(
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ),
        )
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            viewModel.refreshEveningSurfaces()
            return
        }
        if (notificationPermissionLaunchInFlight || notificationPermissionWasRequested()) return

        notificationPermissionLaunchInFlight = true
        getPreferences(MODE_PRIVATE)
            .edit { putBoolean(NOTIFICATION_PERMISSION_REQUESTED_KEY, true) }
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun notificationPermissionWasRequested(): Boolean =
        getPreferences(MODE_PRIVATE)
            .getBoolean(NOTIFICATION_PERMISSION_REQUESTED_KEY, false)

    private fun requestTextInput(
        title: String,
        hint: String,
        numeric: Boolean,
        callback: (String?) -> Unit,
    ) {
        pendingTextResult = callback
        val input = RemoteInput.Builder(INPUT_RESULT_KEY)
            .setLabel(hint)
            .setAllowFreeFormInput(true)
            .build()
        val intent: Intent = RemoteInputIntentHelper.createActionRemoteInputIntent()
        RemoteInputIntentHelper.putRemoteInputsExtra(intent, listOf(input))
        RemoteInputIntentHelper.putTitleExtra(intent, title)
        RemoteInputIntentHelper.putConfirmLabelExtra(intent, "Potvrdit")
        RemoteInputIntentHelper.putCancelLabelExtra(intent, "Zrušit")
        if (numeric) {
            intent.putExtra(EXTRA_NUMERIC_HINT, true)
        }
        remoteInput.launch(intent)
    }

    companion object {
        private const val INPUT_RESULT_KEY = "na_pivo_input"
        private const val EXTRA_NUMERIC_HINT = "na_pivo_numeric"
        private const val NOTIFICATION_PERMISSION_REQUESTED_KEY =
            "notification_permission_requested"
    }
}
