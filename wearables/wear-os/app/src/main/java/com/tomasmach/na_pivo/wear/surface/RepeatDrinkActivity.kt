package com.tomasmach.na_pivo.wear.surface

import android.content.Intent
import android.os.Bundle
import android.view.HapticFeedbackConstants
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.material3.Text
import com.tomasmach.na_pivo.wear.R
import com.tomasmach.na_pivo.wear.ui.Baloo2FontFamily
import com.tomasmach.na_pivo.wear.ui.InterFontFamily
import com.tomasmach.na_pivo.wear.ui.NaPivoColors
import com.tomasmach.na_pivo.wear.ui.NaPivoWearTheme
import com.tomasmach.na_pivo.wear.wearApplication
import kotlinx.coroutines.launch

class RepeatDrinkActivity : ComponentActivity() {
    private var resultText by mutableStateOf("Zapisuju…")
    private var detailText by mutableStateOf("")
    private var undoDrinkId: String? = null
    private var repeatInFlight = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTheme(R.style.Theme_NaPivoWear)
        setContent {
            NaPivoWearTheme {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(NaPivoColors.Stout)
                        .padding(18.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            resultText,
                            color = NaPivoColors.Foam,
                            fontSize = 23.sp,
                            fontFamily = Baloo2FontFamily,
                            fontWeight = FontWeight.ExtraBold,
                            textAlign = TextAlign.Center,
                        )
                        if (detailText.isNotBlank()) {
                            Text(
                                detailText,
                                color = NaPivoColors.Amber,
                                fontSize = 12.sp,
                                fontFamily = InterFontFamily,
                                fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.Center,
                            )
                        }
                        if (undoDrinkId != null) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(22.dp))
                                    .background(NaPivoColors.Amber)
                                    .combinedClickable(onClick = ::undo)
                                    .padding(12.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "Vrátit",
                                    color = NaPivoColors.Stout,
                                    fontFamily = Baloo2FontFamily,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    }
                }
                LaunchedEffect(Unit) {
                    if (intent.action == ACTION_REPEAT || intent.action == null) repeat()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACTION_REPEAT || intent.action == null) repeat()
    }

    private fun repeat() {
        if (repeatInFlight) return
        repeatInFlight = true
        lifecycleScope.launch {
            try {
                val app = wearApplication
                app.container.repository.initialize()
                val result = app.container.repository.repeatLast()
                if (result.applied && result.drink != null) {
                    undoDrinkId = result.drink.id
                    resultText = "Zapsáno"
                    detailText = result.drink.descriptor
                    window.decorView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)
                    val current = app.container.transport.flushOutbox()
                    EveningSurfaceController.refresh(
                        this@RepeatDrinkActivity,
                        current,
                    )
                } else {
                    resultText = result.message ?: "Něco nesedí"
                    detailText = ""
                }
            } finally {
                repeatInFlight = false
            }
        }
    }

    private fun undo() {
        val id = undoDrinkId ?: return
        undoDrinkId = null
        lifecycleScope.launch {
            val app = wearApplication
            val result = app.container.repository.removeDrink(id, "undo")
            resultText = if (result.applied) "Vráceno" else "Už je pryč"
            detailText = ""
            val current = app.container.transport.flushOutbox()
            EveningSurfaceController.refresh(this@RepeatDrinkActivity, current)
        }
    }

    companion object {
        const val ACTION_REPEAT = "com.tomasmach.na_pivo.wear.action.REPEAT"
    }
}
