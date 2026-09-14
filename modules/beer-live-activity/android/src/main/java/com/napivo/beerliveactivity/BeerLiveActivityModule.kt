package com.napivo.beerliveactivity

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BeerLiveActivityModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("BeerLiveActivity")

    AsyncFunction("startOrUpdate") { payload: BeerLiveActivityPayload ->
      BeerLiveActivityNotification.startOrUpdate(context, payload)
    }

    AsyncFunction("end") {
      BeerLiveActivityNotification.end(context)
    }

    AsyncFunction("getStatus") {
      BeerLiveActivityNotification.getStatus(context)
    }

    AsyncFunction("getPendingAdds") {
      BeerLiveActivityNotification.getPendingAdds(context)
    }

    AsyncFunction("ackPendingAdds") { ids: List<String> ->
      BeerLiveActivityNotification.ackPendingAdds(context, ids)
    }

    AsyncFunction("clearPendingAdds") {
      BeerLiveActivityNotification.clearPendingAdds(context)
    }
  }
}
