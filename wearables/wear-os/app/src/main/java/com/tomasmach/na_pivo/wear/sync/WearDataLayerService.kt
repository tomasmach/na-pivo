package com.tomasmach.na_pivo.wear.sync

import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Node
import com.google.android.gms.wearable.WearableListenerService
import com.tomasmach.na_pivo.wear.data.JsonCodec
import com.tomasmach.na_pivo.wear.data.WearRepository
import com.tomasmach.na_pivo.wear.surface.EveningSurfaceController
import com.tomasmach.na_pivo.wear.wearApplication
import kotlinx.coroutines.launch

class WearDataLayerService : WearableListenerService() {
    override fun onDataChanged(dataEvents: DataEventBuffer) {
        val app = wearApplication
        dataEvents
            .filter { it.type == DataEvent.TYPE_CHANGED }
            .mapNotNull { event ->
                val path = event.dataItem.uri.path.orEmpty()
                if (!path.startsWith("/na-pivo/v1/")) return@mapNotNull null
                val bytes = DataLayerTransport.envelopeBytes(
                    DataMapItem.fromDataItem(event.dataItem).dataMap,
                ) ?: return@mapNotNull null
                path to bytes.copyOf()
            }
            .forEach { (path, bytes) ->
                app.container.applicationScope.launch {
                    when (JsonCodec.parseKind(bytes)) {
                        "state_snapshot" -> {
                            val snapshot = runCatching { JsonCodec.decodeSnapshot(bytes) }.getOrNull()
                                ?: return@launch
                            app.container.repository.applyRemoteSnapshot(snapshot)
                            val current = app.container.transport.flushOutbox()
                            EveningSurfaceController.refresh(
                                applicationContext,
                                current,
                            )
                        }
                        "ack" -> {
                            val ack = runCatching { JsonCodec.decodeAck(bytes) }.getOrNull()
                                ?: return@launch
                            val removed = app.container.repository.applyAck(ack)
                            app.container.transport.deleteAcked(removed)
                            app.container.transport.deleteAppliedAck(path)
                            val current = app.container.repository.authoritativeState()
                            EveningSurfaceController.refresh(
                                applicationContext,
                                current,
                            )
                        }
                    }
                }
            }
    }

    override fun onPeerConnected(peer: Node) {
        val app = wearApplication
        app.container.applicationScope.launch {
            app.container.transport.updateConnectivity()
            app.container.transport.flushOutbox()
        }
    }

    override fun onPeerDisconnected(peer: Node) {
        val app = wearApplication
        app.container.applicationScope.launch {
            app.container.transport.updateConnectivity()
        }
    }
}
