package com.napivo.beerliveactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BeerLiveActivityActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val sessionId = intent.getStringExtra(BeerLiveActivityNotification.EXTRA_SESSION_ID)
      ?.takeIf { it.isNotBlank() }
      ?: return
    when (intent.action) {
      BeerLiveActivityNotification.ACTION_DISMISSED ->
        BeerLiveActivityNotification.markDismissed(context, sessionId)
      BeerLiveActivityNotification.ACTION_ADD_BEER ->
        BeerLiveActivityNotification.addBeer(context, sessionId)
    }
  }
}
