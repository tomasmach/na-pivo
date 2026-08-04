package com.tomasmach.napivo.wearablebridge

import android.content.Context
import android.net.Uri
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.lang.ref.WeakReference
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

class NaPivoWearableBridgeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("NaPivoWearableBridge")
    Events("onWearableCommand", "onWearableTransportChanged")

    OnCreate {
      activeModule = WeakReference(this@NaPivoWearableBridgeModule)
      appContext.reactContext?.applicationContext?.let { applicationContext ->
        retryScope.launch {
          retryPendingStateDeletion(applicationContext)
        }
      }
    }

    OnDestroy {
      activeModule?.get()
        ?.takeIf { it === this@NaPivoWearableBridgeModule }
        ?.let { activeModule = null }
    }

    AsyncFunction("publishSnapshot") Coroutine { envelopeJson: String ->
      StatePathProcessCoordinator.transaction {
        val store = WearableInboxStore(context)
        val replacingClearedSnapshot = store.stateDeletionPending()
        if (replacingClearedSnapshot) retryPendingStateDeletionLocked(context)
        store.storeSnapshotMetadata(envelopeJson)
        putEnvelope(
          context = context,
          path = DataPaths.STATE,
          envelopeJson = envelopeJson,
          messageId = JSONObject(envelopeJson).getString("messageId"),
          transportNonce = UUID.randomUUID().toString(),
        )
        if (replacingClearedSnapshot) store.markStateDeletionCompleted()
        store.markSent()
      }
    }

    AsyncFunction("getPendingCommands") {
      WearableInboxStore(context).pendingCommands()
    }

    AsyncFunction("getAcknowledgedActorSequences") { accountEpoch: String ->
      WearableInboxStore(context).acknowledgedActorSequences(accountEpoch)
    }

    AsyncFunction("ackPendingCommands") Coroutine { messageIds: List<String> ->
      val ids = messageIds.filter { it.isNotBlank() }.distinct().toSet()
      if (ids.isEmpty()) return@Coroutine true
      val store = WearableInboxStore(context)
      val metadata = store.nextAckMetadata()
      val ackMessageId = UUID.randomUUID().toString()
      val envelope = JSONObject()
        .put("protocolVersion", 1)
        .put("messageId", ackMessageId)
        .put("accountEpoch", metadata.accountEpoch)
        .put("actorId", metadata.actorId)
        .put("actorKind", "phone")
        .put("actorSequence", metadata.actorSequence)
        .put("baseRevision", metadata.revision)
        .put("sentAt", Instant.now().toString())
        .put("kind", "ack")
        .put(
          "payload",
          JSONObject()
            .put("acknowledgedMessageIds", JSONArray(ids.toList()))
            .put("revision", metadata.revision),
        )
        .toString()
      putEnvelope(
        context = context,
        path = DataPaths.ack(ackMessageId),
        envelopeJson = envelope,
        messageId = ackMessageId,
      )
      // A successful ACK DataItem put transfers durable ownership to the phone.
      // Advance watermarks in the same commit that removes the owned inbox rows;
      // deleting the watch command DataItems is only best-effort cleanup.
      store.acknowledge(ids)
      runCatching { store.markSent() }
      runCatching { deleteCommandItems(context, ids) }
    }

    AsyncFunction("getTransportStatus") Coroutine { ->
      if (WearableInboxStore(context).stateDeletionPending()) {
        val applicationContext = context.applicationContext
        retryScope.launch { retryPendingStateDeletion(applicationContext) }
      }
      transportStatus(context)
    }

    AsyncFunction("requestSync") Coroutine { ->
      StatePathProcessCoordinator.transaction {
        retryPendingStateDeletionLocked(context)
        val snapshot = WearableInboxStore(context).lastSnapshot()
        if (snapshot != null) {
          putEnvelope(
            context = context,
            path = DataPaths.STATE,
            envelopeJson = snapshot,
            messageId = JSONObject(snapshot).getString("messageId"),
            transportNonce = UUID.randomUUID().toString(),
          )
          WearableInboxStore(context).markSent()
        }
      }
    }

    AsyncFunction("clearSnapshot") Coroutine { ->
      StatePathProcessCoordinator.transaction {
        WearableInboxStore(context).clearSnapshot()
      }
      val applicationContext = context.applicationContext
      retryScope.launch { retryPendingStateDeletion(applicationContext) }
    }
  }

  private fun emit(event: String, body: Map<String, Any>) {
    runCatching { sendEvent(event, body) }
  }

  companion object {
    @Volatile
    private var activeModule: WeakReference<NaPivoWearableBridgeModule>? = null
    private val retryScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    internal fun emitPendingEvent(context: Context) {
      activeModule?.get()?.emit(
        "onWearableCommand",
        mapOf("pendingCount" to WearableInboxStore(context).pendingCount()),
      )
    }

    internal fun emitTransportEvent(context: Context) {
      activeModule?.get()?.emit(
        "onWearableTransportChanged",
        mapOf("changed" to true),
      )
    }
  }
}

internal object StatePathProcessCoordinator {
  private val mutex = Mutex()

  suspend fun <T> transaction(block: suspend () -> T): T {
    mutex.lock()
    return try {
      block()
    } finally {
      mutex.unlock()
    }
  }
}

private suspend fun retryPendingStateDeletion(context: Context): Boolean =
  StatePathProcessCoordinator.transaction {
    retryPendingStateDeletionLocked(context)
  }

private suspend fun retryPendingStateDeletionLocked(context: Context): Boolean {
  val store = WearableInboxStore(context)
  if (!store.stateDeletionPending()) return true
  val deleted = withTimeoutOrNull(STATE_DELETE_TIMEOUT_MS) {
    runCatching {
      deleteStateItem(context)
      true
    }.getOrDefault(false)
  } ?: false
  if (deleted) store.markStateDeletionCompleted()
  return deleted
}

private const val STATE_DELETE_TIMEOUT_MS = 5_000L

private suspend fun putEnvelope(
  context: Context,
  path: String,
  envelopeJson: String,
  messageId: String,
  transportNonce: String? = null,
): Boolean {
  val request = PutDataMapRequest.create(path).run {
    dataMap.putByteArray(
      NaPivoPhoneWearableListenerService.ENVELOPE_KEY,
      envelopeJson.toByteArray(Charsets.UTF_8),
    )
    dataMap.putString(
      NaPivoPhoneWearableListenerService.MESSAGE_ID_KEY,
      messageId,
    )
    transportNonce?.let { dataMap.putString("transport_nonce", it) }
    asPutDataRequest().setUrgent()
  }
  Wearable.getDataClient(context).putDataItem(request).await()
  return true
}

private suspend fun deleteCommandItems(context: Context, messageIds: Set<String>) {
  val client = Wearable.getDataClient(context)
  messageIds.forEach { messageId ->
    val expectedPath = DataPaths.command(messageId)
    val filterUri = Uri.Builder()
      .scheme("wear")
      .path(expectedPath)
      .build()
    client.getDataItems(filterUri, DataClient.FILTER_LITERAL).await().use { items ->
      items
        .filter { it.uri.path == expectedPath }
        .forEach { client.deleteDataItems(it.uri).await() }
    }
  }
}

private suspend fun deleteStateItem(context: Context) {
  val client = Wearable.getDataClient(context)
  val filterUri = Uri.Builder()
    .scheme("wear")
    .path(DataPaths.STATE)
    .build()
  client.getDataItems(filterUri, DataClient.FILTER_LITERAL).await().use { items ->
    items
      .filter { it.uri.path == DataPaths.STATE }
      .forEach { client.deleteDataItems(it.uri).await() }
  }
}

private suspend fun transportStatus(context: Context): Map<String, Any?> {
  val store = WearableInboxStore(context)
  val apiAvailable = runCatching {
    GoogleApiAvailability.getInstance()
      .checkApiAvailability(Wearable.getDataClient(context))
      .await()
    true
  }.getOrDefault(false)
  val nodes = if (apiAvailable) {
    runCatching { Wearable.getNodeClient(context).connectedNodes.await() }
      .getOrDefault(emptyList())
  } else {
    emptyList()
  }
  if (nodes.isNotEmpty()) store.markPeerSeen()
  return buildTransportStatus(
    supported = apiAvailable,
    paired = nodes.isNotEmpty() || store.hasSeenPeer(),
    reachable = nodes.isNotEmpty(),
    pendingCommands = store.pendingCount(),
    lastReceivedAt = store.lastReceivedAt(),
    lastSentAt = store.lastSentAt(),
  )
}

internal fun buildTransportStatus(
  supported: Boolean,
  paired: Boolean,
  reachable: Boolean,
  pendingCommands: Int,
  lastReceivedAt: String?,
  lastSentAt: String?,
): Map<String, Any?> = mapOf(
  "supported" to supported,
  "paired" to paired,
  "reachable" to reachable,
  "pendingCommands" to pendingCommands,
  "lastReceivedAt" to lastReceivedAt,
  "lastSentAt" to lastSentAt,
)
