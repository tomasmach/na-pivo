package com.tomasmach.na_pivo.wear.sync

import android.content.Context
import android.net.Uri
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMap
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.tomasmach.na_pivo.wear.data.WearRepository
import com.tomasmach.na_pivo.wear.domain.ConnectivityState
import com.tomasmach.na_pivo.wear.domain.PendingEnvelope
import com.tomasmach.na_pivo.wear.domain.PersistedState
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.tasks.await

internal data class TransportPayload(
    val envelope: ByteArray,
    val messageId: String,
    val transportNonce: String,
)

internal fun transportPayload(pending: PendingEnvelope): TransportPayload =
    TransportPayload(
        envelope = pending.json.toByteArray(Charsets.UTF_8),
        messageId = pending.messageId,
        transportNonce = UUID.randomUUID().toString(),
    )

internal suspend fun resolveFlushState(
    supplied: PersistedState?,
    readAuthoritative: suspend () -> PersistedState,
): PersistedState = supplied ?: readAuthoritative()

class DataLayerTransport(
    context: Context,
    private val repository: WearRepository,
) {
    private val appContext = context.applicationContext
    private val mutableConnectivity = MutableStateFlow(ConnectivityState.UNKNOWN)
    val connectivity: StateFlow<ConnectivityState> = mutableConnectivity

    suspend fun flushOutbox(suppliedState: PersistedState? = null): PersistedState {
        val current = resolveFlushState(suppliedState, repository::authoritativeState)
        if (!isAvailable()) {
            mutableConnectivity.value = ConnectivityState.DISCONNECTED
            return current
        }
        val connected = runCatching {
            Wearable.getNodeClient(appContext).connectedNodes.await().isNotEmpty()
        }.getOrDefault(false)
        mutableConnectivity.value =
            if (connected) ConnectivityState.CONNECTED else ConnectivityState.DISCONNECTED

        current.outbox.forEach { pending ->
            publish(pending)
        }
        return current
    }

    suspend fun publish(pending: PendingEnvelope): Boolean {
        val payload = transportPayload(pending)
        val request = PutDataMapRequest.create(pending.path).run {
            dataMap.putByteArray(DATA_KEY, payload.envelope)
            dataMap.putString(MESSAGE_ID_KEY, payload.messageId)
            dataMap.putString(TRANSPORT_NONCE_KEY, payload.transportNonce)
            asPutDataRequest().setUrgent()
        }
        return runCatching {
            Wearable.getDataClient(appContext).putDataItem(request).await()
            true
        }.getOrDefault(false)
    }

    suspend fun publishAck(path: String, envelopeJson: String, messageId: String): Boolean {
        val uniquePath =
            if (path == DataPaths.ACK_PREFIX) DataPaths.ack(messageId) else path
        require(uniquePath == DataPaths.ack(messageId))
        val request = PutDataMapRequest.create(uniquePath).run {
            dataMap.putByteArray(DATA_KEY, envelopeJson.toByteArray(Charsets.UTF_8))
            dataMap.putString(MESSAGE_ID_KEY, messageId)
            dataMap.putString(TRANSPORT_NONCE_KEY, UUID.randomUUID().toString())
            asPutDataRequest().setUrgent()
        }
        return runCatching {
            Wearable.getDataClient(appContext).putDataItem(request).await()
            true
        }.getOrDefault(false)
    }

    suspend fun deleteAcked(pending: Collection<PendingEnvelope>) {
        if (pending.isEmpty()) return
        val client = Wearable.getDataClient(appContext)
        pending.forEach { command ->
            require(command.path == DataPaths.command(command.messageId))
            val filterUri = Uri.Builder()
                .scheme("wear")
                .path(command.path)
                .build()
            runCatching {
                client.getDataItems(filterUri, DataClient.FILTER_LITERAL).await().use { items ->
                    items.forEach { item -> client.deleteDataItems(item.uri).await() }
                }
            }
        }
    }

    suspend fun deleteAppliedAck(path: String) {
        require(DataPaths.isAck(path))
        val client = Wearable.getDataClient(appContext)
        val filterUri = Uri.Builder()
            .scheme("wear")
            .path(path)
            .build()
        runCatching {
            client.getDataItems(filterUri, DataClient.FILTER_LITERAL).await().use { items ->
                items
                    .filter { it.uri.path == path }
                    .forEach { item -> client.deleteDataItems(item.uri).await() }
            }
        }
    }

    suspend fun updateConnectivity() {
        mutableConnectivity.value = runCatching {
            if (Wearable.getNodeClient(appContext).connectedNodes.await().isNotEmpty()) {
                ConnectivityState.CONNECTED
            } else {
                ConnectivityState.DISCONNECTED
            }
        }.getOrDefault(ConnectivityState.UNKNOWN)
    }

    private suspend fun isAvailable(): Boolean = runCatching {
        GoogleApiAvailability.getInstance()
            .checkApiAvailability(Wearable.getDataClient(appContext))
            .await()
        true
    }.getOrDefault(false)

    companion object {
        const val DATA_KEY = "envelope"
        const val MESSAGE_ID_KEY = "message_id"
        const val TRANSPORT_NONCE_KEY = "transport_nonce"

        fun envelopeBytes(dataMap: DataMap): ByteArray? = dataMap.getByteArray(DATA_KEY)
    }
}
