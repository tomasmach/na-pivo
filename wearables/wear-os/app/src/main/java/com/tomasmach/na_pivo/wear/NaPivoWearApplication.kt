package com.tomasmach.na_pivo.wear

import android.app.Application
import com.tomasmach.na_pivo.wear.data.NearbyPubClient
import com.tomasmach.na_pivo.wear.data.WearRepository
import com.tomasmach.na_pivo.wear.data.WearStateStore
import com.tomasmach.na_pivo.wear.surface.EveningSurfaceController
import com.tomasmach.na_pivo.wear.sync.DataLayerTransport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class NaPivoWearApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.applicationScope.launch {
            val state = container.repository.initialize()
            container.transport.flushOutbox(state)
            EveningSurfaceController.refresh(this@NaPivoWearApplication, state)
        }
    }
}

class AppContainer(application: Application) {
    val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val stateStore = WearStateStore(application)
    val repository = WearRepository(stateStore, applicationScope)
    val transport = DataLayerTransport(application, repository)
    val nearbyPubClient = NearbyPubClient()
}

val android.content.Context.wearApplication: NaPivoWearApplication
    get() = applicationContext as NaPivoWearApplication
