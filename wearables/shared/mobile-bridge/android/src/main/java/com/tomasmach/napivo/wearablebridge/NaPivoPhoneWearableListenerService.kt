package com.tomasmach.napivo.wearablebridge

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.WearableListenerService

class NaPivoPhoneWearableListenerService : WearableListenerService() {
  override fun onDataChanged(dataEvents: DataEventBuffer) {
    val store = WearableInboxStore(applicationContext)
    var changed = false
    dataEvents
      .filter { it.type == DataEvent.TYPE_CHANGED }
      .forEach { event ->
        val path = event.dataItem.uri.path.orEmpty()
        if (!DataPaths.isCommand(path)) return@forEach
        val bytes = DataMapItem.fromDataItem(event.dataItem)
          .dataMap
          .getByteArray(ENVELOPE_KEY)
          ?: return@forEach
        val envelope = bytes.toString(Charsets.UTF_8)
        changed = runCatching {
          store.persistCommandBeforeDispatch(envelope)
        }.getOrDefault(false) || changed
      }
    if (changed) {
      NaPivoWearableBridgeModule.emitPendingEvent(applicationContext)
    }
  }

  override fun onPeerConnected(peer: Node) {
    WearableInboxStore(applicationContext).markPeerSeen()
    NaPivoWearableBridgeModule.emitTransportEvent(applicationContext)
  }

  override fun onPeerDisconnected(peer: Node) {
    NaPivoWearableBridgeModule.emitTransportEvent(applicationContext)
  }

  companion object {
    internal const val ENVELOPE_KEY = "envelope"
    internal const val MESSAGE_ID_KEY = "message_id"
  }
}
