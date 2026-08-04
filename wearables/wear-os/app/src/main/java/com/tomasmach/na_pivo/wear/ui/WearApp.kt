package com.tomasmach.na_pivo.wear.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.wear.compose.material3.Text
import com.tomasmach.na_pivo.wear.WearUiState
import com.tomasmach.na_pivo.wear.WearViewModel
import com.tomasmach.na_pivo.wear.domain.ConnectivityState
import com.tomasmach.na_pivo.wear.domain.DrinkChoice
import com.tomasmach.na_pivo.wear.domain.DrinkSpec
import com.tomasmach.na_pivo.wear.domain.DrinkType
import com.tomasmach.na_pivo.wear.domain.PubRef
import com.tomasmach.na_pivo.wear.domain.ServingType
import com.tomasmach.na_pivo.wear.domain.TargetSelection
import com.tomasmach.na_pivo.wear.domain.formatVolume
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

private val Ink = NaPivoColors.Stout
private val Surface = NaPivoColors.Stout2
private val Raised = NaPivoColors.Stout3
private val Amber = NaPivoColors.Amber
private val AmberSoft = NaPivoColors.AmberLight
private val Cream = NaPivoColors.Foam
private val Muted = NaPivoColors.MutedText
private val Danger = NaPivoColors.AmberLight

private sealed interface Screen {
    data object Home : Screen
    data object Compass : Screen
    data object PubList : Screen
    data object Breakdown : Screen
    data object CloseConfirm : Screen
    data class ConfirmPub(val pub: PubRef) : Screen
    data class Drinks(val pub: PubRef) : Screen
    data class NewDrink(
        val pub: PubRef,
        val otherFirst: Boolean,
        val seed: DrinkChoice? = null,
    ) : Screen
}

@Composable
fun NaPivoWearApp(
    viewModel: WearViewModel,
    requestLocationPermission: () -> Unit,
    requestNotificationPermission: () -> Unit,
    requestTextInput: (title: String, hint: String, numeric: Boolean, callback: (String?) -> Unit) -> Unit,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var screen: Screen by remember { mutableStateOf(Screen.Home) }

    LaunchedEffect(state.activeEvening?.eveningId) {
        if (state.activeEvening == null && screen is Screen.Breakdown) screen = Screen.Home
    }

    NaPivoWearTheme {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Ink)
                .semantics { testTagsAsResourceId = true },
        ) {
            if (state.persisted.accountConflictEpoch != null) {
                AccountConflictPage(
                    pendingCount = state.persisted.outbox.size,
                    retry = viewModel::retryAccountSync,
                )
            } else {
                AnimatedContent(
                    targetState = screen,
                    label = "wear-navigation",
                    modifier = Modifier.fillMaxSize(),
                ) { current ->
                    when (current) {
                    Screen.Home -> {
                        if (state.activeEvening == null) {
                            CompassScreen(
                                state = state,
                                hasLocationPermission = viewModel.hasLocationPermission(),
                                requestLocationPermission = requestLocationPermission,
                                openPubs = { screen = Screen.PubList },
                                startDrink = { pub -> screen = Screen.ConfirmPub(pub) },
                                backToCounter = { screen = Screen.Home },
                            )
                        } else {
                            CounterScreen(
                                state = state,
                                repeat = {
                                    viewModel.repeatLast { result ->
                                        if (result.applied) requestNotificationPermission()
                                    }
                                },
                                openDrinks = {
                                    state.activeEvening?.pub?.let { screen = Screen.Drinks(it) }
                                },
                                openCompass = { screen = Screen.Compass },
                                openBreakdown = { screen = Screen.Breakdown },
                                finish = { screen = Screen.CloseConfirm },
                                resolveConflict = viewModel::chooseConflictEvening,
                            )
                        }
                    }

                    Screen.Compass -> CompassScreen(
                        state = state,
                        hasLocationPermission = viewModel.hasLocationPermission(),
                        requestLocationPermission = requestLocationPermission,
                        openPubs = { screen = Screen.PubList },
                        startDrink = { pub -> screen = Screen.ConfirmPub(pub) },
                        backToCounter = { screen = Screen.Home },
                    )

                    Screen.PubList -> PubListScreen(
                        state = state,
                        choose = {
                            viewModel.choosePub(it)
                            screen = Screen.Compass
                        },
                        back = { screen = if (state.activeEvening == null) Screen.Home else Screen.Compass },
                    )

                    is Screen.ConfirmPub -> ConfirmPubScreen(
                        pub = current.pub,
                        confirm = { screen = Screen.Drinks(current.pub) },
                        change = { screen = Screen.PubList },
                        back = { screen = if (state.activeEvening == null) Screen.Home else Screen.Compass },
                    )

                    is Screen.Drinks -> DrinkPickerScreen(
                        state = state,
                        pub = current.pub,
                        select = { choice ->
                            val volume = choice.volumeMl
                            val price = choice.priceCzk
                            if (volume == null || price == null) {
                                screen = Screen.NewDrink(current.pub, false, choice)
                            } else {
                                viewModel.addDrink(
                                    pub = current.pub,
                                    drink = DrinkSpec.create(
                                        name = choice.name,
                                        drinkType = choice.drinkType,
                                        volumeMl = volume,
                                        priceCzk = price,
                                        servingType = choice.servingType,
                                    ),
                                ) { result ->
                                    if (result.applied) {
                                        requestNotificationPermission()
                                        screen = Screen.Home
                                    }
                                }
                            }
                        },
                        addNew = { screen = Screen.NewDrink(current.pub, false) },
                        somethingElse = { screen = Screen.NewDrink(current.pub, true) },
                        back = { screen = Screen.Home },
                    )

                    is Screen.NewDrink -> NewDrinkWizard(
                        pub = current.pub,
                        otherFirst = current.otherFirst,
                        seed = current.seed,
                        requestTextInput = requestTextInput,
                        save = { draft ->
                            viewModel.addDrink(current.pub, draft) { result ->
                                if (result.applied) {
                                    requestNotificationPermission()
                                    screen = Screen.Home
                                }
                            }
                        },
                        back = { screen = Screen.Drinks(current.pub) },
                    )

                    Screen.Breakdown -> BreakdownScreen(
                        state = state,
                        remove = viewModel::removeDrink,
                        back = { screen = Screen.Home },
                    )

                    Screen.CloseConfirm -> CloseConfirmScreen(
                        state = state,
                        confirm = {
                            viewModel.closeEvening { screen = Screen.Home }
                        },
                        back = { screen = Screen.Home },
                    )
                    }
                }
            }

            state.rapidDrink
                ?.takeIf { state.persisted.accountConflictEpoch == null }
                ?.let { drink ->
                RapidConfirmation(
                    drink = drink,
                    confirm = {
                        viewModel.confirmRapid { result ->
                            if (result.applied) {
                                requestNotificationPermission()
                                screen = Screen.Home
                            }
                        }
                    },
                    cancel = viewModel::cancelRapid,
                )
            }

            if (state.persisted.accountConflictEpoch == null && state.rapidDrink == null) {
                state.undoDrinkId?.let {
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 20.dp),
                    ) {
                        SmallAction(
                            text = "Vrátit",
                            onClick = viewModel::undo,
                            modifier = Modifier
                                .width(86.dp)
                                .testTag("undo"),
                            accent = true,
                            compact = true,
                        )
                    }
                }
            }

            state.notice?.let { message ->
                if (state.undoDrinkId == null && state.rapidDrink == null) {
                    Text(
                        text = message,
                        color = Ink,
                        fontSize = 11.sp,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(horizontal = 12.dp)
                            .padding(bottom = 24.dp)
                            .widthIn(max = 134.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(AmberSoft)
                            .padding(horizontal = 12.dp, vertical = 7.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun AccountConflictPage(
    pendingCount: Int,
    retry: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 24.dp, bottom = 18.dp, start = 18.dp, end = 18.dp)
            .testTag("account_conflict"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Eyebrow("Jiný účet")
        FullPubTitle("Zápisy držím tady", compact = true)
        Text(
            text = "Na telefonu přepni zpátky původní účet. Nic nemažu.",
            color = Muted,
            fontSize = 10.sp,
            lineHeight = 13.sp,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
            maxLines = 3,
        )
        Text(
            text = "$pendingCount čeká na odeslání",
            color = Amber,
            fontSize = 11.sp,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
        SmallAction(
            text = "Zkusit po přepnutí",
            onClick = retry,
            modifier = Modifier
                .width(158.dp)
                .testTag("retry_account_sync"),
            accent = true,
        )
    }
}

@Composable
private fun CounterScreen(
    state: WearUiState,
    repeat: () -> Unit,
    openDrinks: () -> Unit,
    openCompass: () -> Unit,
    openBreakdown: () -> Unit,
    finish: () -> Unit,
    resolveConflict: (String) -> Unit,
) {
    val evening = state.activeEvening ?: return
    val last = evening.lastDrink
    val conflictBranches = state.persisted.eveningConflictBranches
    if (conflictBranches.isNotEmpty()) {
        EveningConflictPage(
            branches = conflictBranches,
            choose = resolveConflict,
        )
        return
    }
    var detailsPage by remember(evening.eveningId) { mutableStateOf(false) }
    AnimatedContent(
        targetState = detailsPage,
        label = "counter-pages",
        modifier = Modifier
            .fillMaxSize()
            .testTag("counter"),
    ) { showDetails ->
        if (showDetails) {
            CounterActionsPage(
                state = state,
                last = last,
                back = { detailsPage = false },
                openDrinks = openDrinks,
                openBreakdown = openBreakdown,
                finish = finish,
            )
        } else {
            CounterSummaryPage(
                state = state,
                last = last,
                repeat = repeat,
                openDrinks = openDrinks,
                openCompass = openCompass,
                showDetails = { detailsPage = true },
            )
        }
    }
}

@Composable
private fun CounterSummaryPage(
    state: WearUiState,
    last: DrinkSpec?,
    repeat: () -> Unit,
    openDrinks: () -> Unit,
    openCompass: () -> Unit,
    showDetails: () -> Unit,
) {
    val evening = state.activeEvening ?: return
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 7.dp, bottom = 25.dp)
            .testTag("counter_summary"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        HeaderAction("← Kompas", openCompass, tag = "open_compass")
        Eyebrow("${evening.pub.name} · ${compactSyncText(state)}")
        Row(
            modifier = Modifier.height(59.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = evening.beerCount.toString(),
                color = Amber,
                fontSize = 52.sp,
                lineHeight = 52.sp,
                fontFamily = Baloo2FontFamily,
                fontWeight = FontWeight.ExtraBold,
            )
            Column {
                Text(
                    text = beerCountLabel(evening.beerCount),
                    color = NaPivoColors.FoamMuted,
                    fontSize = 14.sp,
                    fontFamily = Baloo2FontFamily,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.4.sp,
                )
                if (evening.otherCounts.isNotEmpty()) {
                    Text(
                        text = evening.otherCounts.entries.joinToString(" · ") {
                            "${it.key.czechName} ${it.value}"
                        },
                        color = Muted,
                        fontSize = 9.sp,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Medium,
                        maxLines = 1,
                    )
                }
            }
        }
        if (last != null) {
            PrimaryAction(
                title = "Přidat ${last.name}",
                subtitle = last.descriptor,
                onClick = repeat,
                onLongClick = openDrinks,
                tag = "cta_repeat",
                modifier = Modifier.width(176.dp),
                compact = true,
                singleLine = true,
            )
        }
        if (state.undoDrinkId == null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                modifier = Modifier.width(148.dp),
            ) {
                SmallAction(
                    text = "+ drink",
                    onClick = openDrinks,
                    modifier = Modifier
                        .weight(1f)
                        .testTag("open_drinks"),
                    compact = true,
                )
                SmallAction(
                    text = "Účet →",
                    onClick = showDetails,
                    modifier = Modifier
                        .weight(1f)
                        .testTag("counter_show_actions"),
                    compact = true,
                )
            }
        } else {
            Spacer(Modifier.height(36.dp))
        }
    }
}

@Composable
private fun CounterActionsPage(
    state: WearUiState,
    last: DrinkSpec?,
    back: () -> Unit,
    openDrinks: () -> Unit,
    openBreakdown: () -> Unit,
    finish: () -> Unit,
) {
    val evening = state.activeEvening ?: return
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 8.dp, bottom = 14.dp)
            .testTag("counter_actions"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        HeaderAction("← Počítadlo", back, tag = "counter_back")
        FullPubTitle(last?.name ?: "Bez drinku", compact = true)
        Text(
            text = last?.descriptor ?: "Zatím nic",
            color = Muted,
            fontSize = 9.sp,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = "Účet ${evening.totalCzk} Kč",
            color = Cream,
            fontSize = 20.sp,
            fontFamily = Baloo2FontFamily,
            fontWeight = FontWeight.ExtraBold,
        )
        SmallAction(
            text = "Vybrat jiný drink",
            onClick = openDrinks,
            modifier = Modifier
                .width(166.dp)
                .testTag("open_drinks_details"),
            compact = true,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(5.dp),
            modifier = Modifier.width(166.dp),
        ) {
            SmallAction(
                text = "Rozpis",
                onClick = openBreakdown,
                modifier = Modifier
                    .weight(1f)
                    .testTag("breakdown"),
                compact = true,
            )
            SmallAction(
                text = "Dopito",
                onClick = finish,
                modifier = Modifier
                    .weight(1f)
                    .testTag("finish"),
                compact = true,
            )
        }
        SyncLine(state, modifier = Modifier.widthIn(max = 110.dp))
    }
}

@Composable
private fun EveningConflictPage(
    branches: List<com.tomasmach.na_pivo.wear.domain.EveningState>,
    choose: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 20.dp, bottom = 24.dp)
            .testTag("evening_conflict"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Eyebrow("SOUČASNĚ DVA VEČERY")
        Title("Který platí?")
        Text(
            text = "Drinky zůstanou odděleně.",
            color = Muted,
            fontSize = 9.sp,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
        )
        branches.take(2).forEachIndexed { index, branch ->
            SecondaryAction(
                title = branch.pub.name,
                subtitle =
                    "${branch.beerCount} ${beerCountLabel(branch.beerCount).lowercase()} · " +
                        "${branch.totalCzk} Kč",
                onClick = { choose(branch.eveningId) },
                modifier = Modifier
                    .width(156.dp)
                    .testTag("resolve_conflict_$index"),
                compact = true,
            )
        }
    }
}

@Composable
private fun CompassScreen(
    state: WearUiState,
    hasLocationPermission: Boolean,
    requestLocationPermission: () -> Unit,
    openPubs: () -> Unit,
    startDrink: (PubRef) -> Unit,
    backToCounter: () -> Unit,
) {
    val target = state.effectiveTarget
    when {
        !state.persisted.initialized -> CompassEmptyPage(tag = "compass_loading") {
            Text("…", color = Amber, fontSize = 46.sp)
            Title("Chystám kompas…")
        }

        target == null && !hasLocationPermission -> CompassEmptyPage(tag = "compass_permission") {
            Text("◎", color = Amber, fontSize = 46.sp)
            Title("Kde vlastně jsi?")
            Body("Povol polohu. Trasu ani GPS historii neukládáme.")
            PrimaryAction(
                title = "Povolit polohu",
                subtitle = "Jen pro kompas a okolní hospody",
                onClick = requestLocationPermission,
                tag = "location_permission",
            )
        }

        target == null -> CompassEmptyPage(tag = "compass_searching") {
            Text("…", color = Amber, fontSize = 46.sp)
            Title("Hledám hospodu")
            Body(
                if (state.connectivity == ConnectivityState.DISCONNECTED) {
                    "Bez signálu. Počkám na telefon nebo síť."
                } else {
                    "Chvilku strpení, rozhlížím se."
                },
            )
        }

        else -> {
            var actionPage by remember(target.pubKey) { mutableStateOf(false) }
            AnimatedContent(
                targetState = actionPage,
                label = "compass-pages",
                modifier = Modifier
                    .fillMaxSize()
                    .testTag("compass"),
            ) { showActions ->
                if (showActions) {
                    CompassActionPage(
                        state = state,
                        target = target,
                        showCompass = { actionPage = false },
                        openPubs = openPubs,
                        startDrink = startDrink,
                        backToCounter = backToCounter,
                    )
                } else {
                    CompassHeroPage(
                        state = state,
                        target = target,
                        showActions = { actionPage = true },
                        backToCounter = backToCounter,
                    )
                }
            }
        }
    }
}

@Composable
private fun CompassHeroPage(
    state: WearUiState,
    target: PubRef,
    showActions: () -> Unit,
    backToCounter: () -> Unit,
) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .testTag("compass_hero"),
    ) {
        val dialFraction = if (state.activeEvening == null) 0.78f else 0.76f
        val dialSize = (minOf(maxWidth, maxHeight) * dialFraction).coerceAtLeast(120.dp)
        CompassArrow(
            rotation = state.compass.arrowRotationDegrees,
            dialSize = dialSize,
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(y = (-3).dp),
        )
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = if (state.activeEvening == null) 15.dp else 10.dp)
                .width(
                    if (state.activeEvening == null) {
                        160.dp
                    } else {
                        minOf(150.dp, maxWidth * 0.70f)
                    },
                )
                .then(
                    if (state.activeEvening == null) {
                        Modifier.combinedClickable(onClick = showActions)
                    } else {
                        Modifier
                    },
                )
                .padding(horizontal = 4.dp, vertical = 2.dp)
                .testTag("compass_show_actions"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            FullPubTitle(target.name, compact = true)
            val distance = state.compass.distanceMeters?.let(::formatDistance) ?: "Vzdálenost neznám"
            if (state.activeEvening == null) {
                Text(
                    text = buildString {
                        append(distance)
                        append(
                            if (state.compass.arrowRotationDegrees == null) {
                                " · směr čeká →"
                            } else {
                                " · akce →"
                            },
                        )
                    },
                    color = AmberSoft,
                    fontSize = 12.sp,
                    fontFamily = InterFontFamily,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CompactTextAction(
                        text = "← Počítadlo",
                        onClick = backToCounter,
                        tag = "back_counter",
                    )
                    CompactTextAction(
                        text = "$distance · akce →",
                        onClick = showActions,
                        tag = "compass_actions_active",
                    )
                }
            }
        }
    }
}

@Composable
private fun CompassActionPage(
    state: WearUiState,
    target: PubRef,
    showCompass: () -> Unit,
    openPubs: () -> Unit,
    startDrink: (PubRef) -> Unit,
    backToCounter: () -> Unit,
) {
    val activePubKey = state.activeEvening?.pub?.pubKey
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 8.dp, bottom = 14.dp)
            .testTag("compass_actions"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        HeaderAction(
            text = "← Kompas",
            onClick = showCompass,
            tag = "show_compass",
        )
        Text(
            text = buildString {
                append(
                    when (state.persisted.target?.selection) {
                        TargetSelection.MANUAL -> "RUČNĚ"
                        TargetSelection.NEAREST, null -> "NEJBLIŽŠÍ"
                    },
                )
                append(" · ")
                append(state.compass.distanceMeters?.let(::formatDistance) ?: "VZDÁLENOST NEZNÁM")
            },
            color = Amber,
            fontSize = 9.sp,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
        FullPubTitle(target.name, compact = true)
        SmallAction(
            text = "Vybrat jinou hospodu",
            onClick = openPubs,
            modifier = Modifier
                .width(166.dp)
                .testTag("change_target"),
            compact = true,
        )
        when {
            activePubKey == null -> PrimaryAction(
                title = "Zapsat první drink",
                subtitle = "Hospodu ještě potvrdíš",
                onClick = { startDrink(target) },
                tag = "first_drink",
                compact = true,
            )

            activePubKey != target.pubKey -> PrimaryAction(
                title = "Zapsat tady",
                subtitle = "Starý účet zůstane tam",
                onClick = { startDrink(target) },
                tag = "drink_here",
                modifier = Modifier.width(156.dp),
                compact = true,
                singleLine = true,
            )

            else -> SmallAction(
                text = "Zpět k počítadlu",
                onClick = backToCounter,
                modifier = Modifier.width(166.dp),
                compact = true,
            )
        }
        SyncLine(state, modifier = Modifier.widthIn(max = 132.dp))
    }
}

@Composable
private fun CompassEmptyPage(
    tag: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 26.dp, vertical = 28.dp)
            .testTag(tag),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        content = content,
    )
}

@Composable
private fun PubListScreen(
    state: WearUiState,
    choose: (PubRef) -> Unit,
    back: () -> Unit,
) {
    val pubs = state.nearbyPubs.take(6)
    var selectedIndex by remember(pubs.map { it.pubKey }) { mutableIntStateOf(0) }
    LaunchedEffect(pubs.size) {
        selectedIndex = selectedIndex.coerceIn(0, (pubs.size - 1).coerceAtLeast(0))
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 18.dp, bottom = 22.dp)
            .testTag("pub_picker"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterVertically),
    ) {
        HeaderAction("← Kompas", back)
        Title("Kam to bude?")
        if (pubs.isEmpty()) {
            Body("Žádné další hospody zatím nemám.")
        } else {
            val pub = pubs[selectedIndex]
            val distance = state.location?.let {
                com.tomasmach.na_pivo.wear.data.haversineMeters(
                    it.latitude,
                    it.longitude,
                    pub.latitude,
                    pub.longitude,
                )
            }
            SecondaryAction(
                title = pub.name,
                subtitle = distance?.let(::formatDistance) ?: pub.city.orEmpty(),
                onClick = { choose(pub) },
                modifier = Modifier
                    .width(166.dp)
                    .testTag("pub_option_$selectedIndex"),
                compact = true,
            )
            if (pubs.size > 1) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    modifier = Modifier.width(150.dp),
                ) {
                    SmallAction(
                        text = "←",
                        onClick = {
                            selectedIndex = (selectedIndex - 1 + pubs.size) % pubs.size
                        },
                        modifier = Modifier
                            .weight(1f)
                            .testTag("previous_pub"),
                        compact = true,
                    )
                    SmallAction(
                        text = "Další →",
                        onClick = { selectedIndex = (selectedIndex + 1) % pubs.size },
                        modifier = Modifier
                            .weight(1f)
                            .testTag("next_pub"),
                        compact = true,
                    )
                }
            }
        }
        if (state.persisted.isStale) Body("Seznam může být starší.")
    }
}

@Composable
private fun ConfirmPubScreen(
    pub: PubRef,
    confirm: () -> Unit,
    change: () -> Unit,
    back: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 15.dp)
            .testTag("confirm_pub"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
    ) {
        HeaderAction("← Zpět", back)
        FullPubTitle(pub.name, compact = true)
        Body("GPS návštěvu nepotvrzuje. To musíš ty.")
        PrimaryAction(
            title = "Jo, tady jsem",
            subtitle = "Teď vyber konkrétní drink",
            onClick = confirm,
            tag = "confirm_pub_yes",
            modifier = Modifier.width(160.dp),
            compact = true,
        )
        SmallAction(
            text = "Jiná hospoda",
            onClick = change,
            modifier = Modifier
                .width(140.dp)
                .testTag("confirm_pub_change"),
            compact = true,
        )
    }
}

@Composable
private fun DrinkPickerScreen(
    state: WearUiState,
    pub: PubRef,
    select: (DrinkChoice) -> Unit,
    addNew: () -> Unit,
    somethingElse: () -> Unit,
    back: () -> Unit,
) {
    val recent = state.persisted.recentDrinks.take(4)
    val frequent = state.persisted.frequentDrinks
        .filterNot { candidate ->
            recent.any { recentDrink ->
                candidateDefinition(candidate) == candidateDefinition(recentDrink)
            }
        }
        .take(4)
    val menu =
        if (pub.pubKey == state.persisted.target?.pub?.pubKey) {
            state.persisted.menuDrinks.take(8)
        } else {
            emptyList()
        }
    val entries = buildList {
        recent.forEachIndexed { index, drink ->
            add(DrinkPickerEntry("POSLEDNÍ", drink, "recent_drink_$index"))
        }
        frequent.forEachIndexed { index, drink ->
            add(DrinkPickerEntry("ČASTÉ", drink, "frequent_drink_$index"))
        }
        menu.forEachIndexed { index, drink ->
            add(DrinkPickerEntry("NABÍDKA HOSPODY", drink, "menu_drink_$index"))
        }
    }
    var selectedIndex by remember(pub.pubKey, entries.map { it.choice.choiceId }) {
        mutableIntStateOf(0)
    }
    LaunchedEffect(entries.size) {
        selectedIndex = selectedIndex.coerceIn(0, (entries.size - 1).coerceAtLeast(0))
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 12.dp, bottom = 19.dp)
            .testTag("drink_picker"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterVertically),
    ) {
        HeaderAction("← Co si dáš?", back)
        if (entries.isEmpty()) {
            Body("Zatím tu nemáš žádný konkrétní drink.")
        } else {
            val entry = entries[selectedIndex]
            Eyebrow("${entry.section} · ${selectedIndex + 1}/${entries.size}")
            SecondaryAction(
                title = entry.choice.name,
                subtitle = entry.choice.descriptor,
                onClick = { select(entry.choice) },
                modifier = Modifier
                    .width(166.dp)
                    .testTag(entry.tag),
                compact = true,
            )
            if (entries.size > 1) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    modifier = Modifier.width(150.dp),
                ) {
                    SmallAction(
                        text = "←",
                        onClick = {
                            selectedIndex = (selectedIndex - 1 + entries.size) % entries.size
                        },
                        modifier = Modifier
                            .weight(1f)
                            .testTag("previous_choice"),
                        compact = true,
                    )
                    SmallAction(
                        text = "Další →",
                        onClick = { selectedIndex = (selectedIndex + 1) % entries.size },
                        modifier = Modifier
                            .weight(1f)
                            .testTag("next_choice"),
                        compact = true,
                    )
                }
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(5.dp),
            modifier = Modifier.width(150.dp),
        ) {
            SmallAction(
                text = "+ nový",
                onClick = addNew,
                modifier = Modifier
                    .weight(1f)
                    .testTag("add_new"),
                compact = true,
            )
            HeaderAction(
                text = "Něco jiného",
                onClick = somethingElse,
                tag = "something_else",
                modifier = Modifier.weight(1f),
            )
        }
    }
}

private data class DrinkPickerEntry(
    val section: String,
    val choice: DrinkChoice,
    val tag: String,
)

private enum class WizardStep {
    TYPE,
    NAME,
    NAME_CONFIRM,
    VOLUME,
    PRICE,
    REVIEW,
}

@Composable
private fun NewDrinkWizard(
    pub: PubRef,
    otherFirst: Boolean,
    seed: DrinkChoice?,
    requestTextInput: (String, String, Boolean, (String?) -> Unit) -> Unit,
    save: (DrinkSpec) -> Unit,
    back: () -> Unit,
) {
    var step by remember(pub.pubKey, otherFirst, seed?.choiceId) {
        mutableStateOf(
            when {
                seed == null -> WizardStep.TYPE
                seed.volumeMl == null -> WizardStep.VOLUME
                seed.priceCzk == null -> WizardStep.PRICE
                else -> WizardStep.REVIEW
            },
        )
    }
    var type by remember(seed?.choiceId) {
        mutableStateOf(seed?.drinkType ?: if (otherFirst) DrinkType.SOFT_DRINK else DrinkType.BEER)
    }
    var name by remember(seed?.choiceId) { mutableStateOf(seed?.name.orEmpty()) }
    var volumeMl by remember(seed?.choiceId) {
        mutableIntStateOf(seed?.volumeMl ?: defaultVolume(seed?.drinkType ?: type))
    }
    var priceCzk by remember(seed?.choiceId) { mutableIntStateOf(seed?.priceCzk ?: 55) }
    var error by remember { mutableStateOf<String?>(null) }

    fun askName() {
        requestTextInput("Jak se drink jmenuje?", "Nadiktuj nebo napiš název", false) { value ->
            if (value != null) {
                name = value.take(80)
                step = WizardStep.NAME_CONFIRM
                error = null
            }
        }
    }

    fun askVolume() {
        requestTextInput("Kolik mililitrů?", "Třeba 450", true) { value ->
            val parsed = value?.filter(Char::isDigit)?.toIntOrNull()
            val valid = parsed != null &&
                if (type == DrinkType.SHOT) parsed in 10..200 else parsed in 10..3000
            if (valid) {
                volumeMl = parsed!!
                step = WizardStep.PRICE
                error = null
            } else if (value != null) {
                error = if (type == DrinkType.SHOT) "Panák může mít 10–200 ml." else "Zadej 10–3000 ml."
            }
        }
    }

    fun askPrice() {
        requestTextInput("Kolik stojí?", "Cena 1–1000 Kč", true) { value ->
            val parsed = value?.filter(Char::isDigit)?.toIntOrNull()
            if (parsed != null && parsed in 1..1000) {
                priceCzk = parsed
                step = WizardStep.REVIEW
                error = null
            } else if (value != null) {
                error = "Cena musí být 1–1000 Kč."
            }
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 8.dp, bottom = 15.dp)
            .testTag("new_drink"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        HeaderAction(
            text = "← " + if (step == WizardStep.TYPE) "Drinky" else "Zpět",
            onClick = {
                step = when (step) {
                    WizardStep.TYPE -> {
                        back()
                        WizardStep.TYPE
                    }
                    WizardStep.NAME -> WizardStep.TYPE
                    WizardStep.NAME_CONFIRM -> WizardStep.NAME
                    WizardStep.VOLUME -> WizardStep.NAME_CONFIRM
                    WizardStep.PRICE -> WizardStep.VOLUME
                    WizardStep.REVIEW -> WizardStep.PRICE
                }
            },
        )
        when (step) {
            WizardStep.TYPE -> {
                Title("Co je to?")
                val types = if (otherFirst) {
                    listOf(DrinkType.SOFT_DRINK, DrinkType.WINE, DrinkType.SHOT, DrinkType.BEER)
                } else {
                    listOf(DrinkType.BEER, DrinkType.SOFT_DRINK, DrinkType.WINE, DrinkType.SHOT)
                }
                types.chunked(2).forEach { row ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        modifier = Modifier.width(166.dp),
                    ) {
                        row.forEach { option ->
                            SmallAction(
                                text = typeLabel(option),
                                onClick = {
                                    type = option
                                    volumeMl = defaultVolume(option)
                                    step = WizardStep.NAME
                                },
                                modifier = Modifier
                                    .weight(1f)
                                    .testTag("type_${option.wireName}"),
                                compact = true,
                            )
                        }
                    }
                }
            }

            WizardStep.NAME -> {
                Title("Jak se jmenuje?")
                Body("Žádné obecné „${type.czechName}“. Chceme konkrétní název.")
                PrimaryAction(
                    title = "Nadiktovat / napsat",
                    subtitle = "Použije se systémový vstup hodinek",
                    onClick = ::askName,
                    tag = "name_input",
                    modifier = Modifier.width(166.dp),
                    compact = true,
                )
            }

            WizardStep.NAME_CONFIRM -> {
                Eyebrow("ROZUMĚL JSEM")
                FullPubTitle(name, compact = true)
                if (!com.tomasmach.na_pivo.wear.domain.isConcreteDrinkName(name)) {
                    Body("To je moc obecné. Zkus značku nebo konkrétní název.")
                } else {
                    PrimaryAction(
                        title = "Sedí",
                        subtitle = "Pokračovat k objemu",
                        onClick = { step = WizardStep.VOLUME },
                        tag = "name_confirm",
                        modifier = Modifier.width(166.dp),
                        compact = true,
                    )
                }
                SmallAction(
                    text = "Zadat znovu",
                    onClick = ::askName,
                    modifier = Modifier.width(145.dp),
                    compact = true,
                )
            }

            WizardStep.VOLUME -> {
                Title("Jaký objem?")
                val volumeChoices = volumePresets(type).map { preset ->
                    Triple(formatVolume(preset), "volume_$preset") {
                        volumeMl = preset
                        step = WizardStep.PRICE
                    }
                } + Triple("Jiný objem", "volume_custom", ::askVolume)
                volumeChoices.chunked(2).forEach { row ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        modifier = Modifier.width(166.dp),
                    ) {
                        row.forEach { (label, tag, action) ->
                            SmallAction(
                                text = label,
                                onClick = action,
                                modifier = Modifier
                                    .weight(1f)
                                    .testTag(tag),
                                compact = true,
                            )
                        }
                    }
                }
            }

            WizardStep.PRICE -> {
                Eyebrow("${name} · ${formatVolume(volumeMl)}")
                Title("Kolik stojí?")
                listOf(45, 55, 65, 75).chunked(2).forEach { row ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        modifier = Modifier.width(166.dp),
                    ) {
                        row.forEach { preset ->
                            SmallAction(
                                text = "$preset Kč",
                                onClick = {
                                    priceCzk = preset
                                    step = WizardStep.REVIEW
                                },
                                modifier = Modifier.weight(1f),
                                compact = true,
                            )
                        }
                    }
                }
                SmallAction(
                    text = "Jiná cena",
                    onClick = ::askPrice,
                    modifier = Modifier
                        .width(145.dp)
                        .testTag("price_custom"),
                    compact = true,
                )
            }

            WizardStep.REVIEW -> {
                Eyebrow(type.czechName)
                FullPubTitle(name, compact = true)
                Text(
                    "${formatVolume(volumeMl)} · $priceCzk Kč",
                    color = AmberSoft,
                    fontSize = 16.sp,
                    fontFamily = Baloo2FontFamily,
                    fontWeight = FontWeight.Bold,
                )
                Body("Příště ho nabídnu rovnou.")
                PrimaryAction(
                    title = "Zapsat drink",
                    subtitle = "$name · ${formatVolume(volumeMl)} · $priceCzk Kč",
                    onClick = {
                        save(
                            DrinkSpec.create(
                                name = name,
                                drinkType = type,
                                volumeMl = volumeMl,
                                priceCzk = priceCzk,
                                servingType = ServingType.UNKNOWN,
                            ),
                        )
                    },
                    tag = "save_drink",
                    modifier = Modifier.width(166.dp),
                    compact = true,
                )
            }
        }
        error?.let {
            Text(
                it,
                color = Danger,
                fontSize = 11.sp,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun BreakdownScreen(
    state: WearUiState,
    remove: (String) -> Unit,
    back: () -> Unit,
) {
    val evening = state.activeEvening ?: return
    val drinks = evening.visibleDrinks.asReversed()
    var selectedIndex by remember(drinks.map { it.id }) { mutableIntStateOf(0) }
    LaunchedEffect(drinks.size) {
        selectedIndex = selectedIndex.coerceIn(0, (drinks.size - 1).coerceAtLeast(0))
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 18.dp, bottom = 22.dp)
            .testTag("breakdown_screen"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterVertically),
    ) {
        HeaderAction("← Počítadlo", back)
        Text(
            text = "Účet ${evening.totalCzk} Kč",
            color = Cream,
            fontSize = 20.sp,
            fontFamily = Baloo2FontFamily,
            fontWeight = FontWeight.ExtraBold,
        )
        if (drinks.isEmpty()) {
            Body("Účet je prázdný.")
        } else {
            val drink = drinks[selectedIndex]
            Text(
                text = "${selectedIndex + 1}/${drinks.size} · chybu můžeš odebrat",
                color = Muted,
                fontSize = 9.sp,
                fontFamily = InterFontFamily,
                fontWeight = FontWeight.Medium,
            )
            val rowShape = RoundedCornerShape(20.dp)
            Row(
                modifier = Modifier
                    .width(166.dp)
                    .clip(rowShape)
                    .background(Surface)
                    .border(1.dp, NaPivoColors.Border, rowShape)
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(
                        drink.name,
                        color = Cream,
                        fontSize = 12.sp,
                        fontFamily = InterFontFamily,
                        fontWeight = FontWeight.Bold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        drink.descriptor,
                        color = Muted,
                        fontSize = 9.sp,
                        fontFamily = InterFontFamily,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Box(
                    modifier = Modifier
                        .size(34.dp)
                        .clip(CircleShape)
                        .background(Raised)
                        .combinedClickable(onClick = { remove(drink.id) })
                        .testTag("remove_drink_$selectedIndex"),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        "−",
                        color = Danger,
                        fontSize = 21.sp,
                        fontFamily = Baloo2FontFamily,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                modifier = Modifier.width(150.dp),
            ) {
                SmallAction(
                    text = "←",
                    onClick = {
                        selectedIndex = (selectedIndex - 1 + drinks.size) % drinks.size
                    },
                    modifier = Modifier
                        .weight(1f)
                        .testTag("previous_drink"),
                    compact = true,
                )
                SmallAction(
                    text = "Další →",
                    onClick = { selectedIndex = (selectedIndex + 1) % drinks.size },
                    modifier = Modifier
                        .weight(1f)
                        .testTag("next_drink"),
                    compact = true,
                )
            }
        }
    }
}

@Composable
private fun CloseConfirmScreen(
    state: WearUiState,
    confirm: () -> Unit,
    back: () -> Unit,
) {
    val evening = state.activeEvening ?: return
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp, vertical = 25.dp)
            .testTag("finish_confirm_screen"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterVertically),
    ) {
        HeaderAction("← Ještě ne", back)
        Title("Dopito?")
        Body("${evening.pub.name} · ${evening.visibleDrinks.size} drinků · ${evening.totalCzk} Kč")
        PrimaryAction(
            title = "Jo, dopito",
            subtitle = "Večer uzavřu a pošlu telefonu",
            onClick = confirm,
            tag = "finish_confirm",
            modifier = Modifier.width(166.dp),
            compact = true,
        )
    }
}

@Composable
private fun RapidConfirmation(
    drink: DrinkSpec,
    confirm: () -> Unit,
    cancel: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(NaPivoColors.Stout.copy(alpha = 0.97f))
            .padding(horizontal = 24.dp, vertical = 25.dp)
            .testTag("rapid_confirmation"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Eyebrow("RYCHLÁ KONTROLA")
            Title("Fakt další?")
            Body("${drink.name} · ${drink.descriptor}")
            PrimaryAction(
                title = "Jo, zapsat",
                subtitle = "Je to záměr",
                onClick = confirm,
                tag = "rapid_confirm_yes",
                modifier = Modifier.width(158.dp),
                compact = true,
            )
            SmallAction(
                text = "Ne, překlep",
                onClick = cancel,
                modifier = Modifier
                    .width(140.dp)
                    .testTag("rapid_confirm_no"),
                compact = true,
            )
        }
    }
}

@Composable
private fun CompassArrow(
    rotation: Float?,
    modifier: Modifier = Modifier,
    dialSize: Dp = 204.dp,
) {
    val textMeasurer = rememberTextMeasurer()
    val cardinalFontSize = with(LocalDensity.current) {
        (20.dp * (dialSize.value / 320f)).toSp()
    }
    val cardinalStyle = TextStyle(
        color = Ink,
        fontFamily = Baloo2FontFamily,
        fontSize = cardinalFontSize,
        fontWeight = FontWeight.ExtraBold,
    )
    val cardinalLabels = listOf("S", "V", "J", "Z")
    val textureDots = listOf(
        Triple(135f, 120f, 3f),
        Triple(180f, 100f, 2f),
        Triple(200f, 150f, 2.5f),
        Triple(175f, 200f, 2f),
        Triple(130f, 190f, 3f),
        Triple(110f, 155f, 2f),
    )
    Box(
        modifier = modifier
            .size(dialSize)
            .testTag("compass_dial"),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val scale = size.width / 320f
            val center = Offset(size.width / 2, size.height / 2)
            drawCircle(
                color = Raised,
                radius = 150f * scale,
                center = center,
            )
            drawCircle(
                color = Amber,
                radius = 150f * scale,
                center = center,
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 3f * scale),
            )
            drawCircle(
                color = Amber.copy(alpha = 0.45f),
                radius = 132f * scale,
                center = center,
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1f * scale),
            )
            drawCircle(
                color = Cream,
                radius = 120f * scale,
                center = center,
            )
            drawCircle(
                color = Amber,
                radius = 120f * scale,
                center = center,
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1.5f * scale),
            )
            drawCircle(
                color = Amber.copy(alpha = 0.55f),
                radius = 104f * scale,
                center = center,
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 1f * scale),
            )
            textureDots.forEach { (x, y, radius) ->
                drawCircle(
                    color = NaPivoColors.White.copy(alpha = 0.55f),
                    radius = radius * scale,
                    center = Offset(x * scale, y * scale),
                )
            }
            repeat(24) { index ->
                val angle = index * 15f
                val radians = (angle - 90f) * PI.toFloat() / 180f
                val cardinal = index % 6 == 0
                drawCircle(
                    color = if (cardinal) Amber else Muted.copy(alpha = 0.7f),
                    radius = (if (cardinal) 4f else 1.8f) * scale,
                    center = Offset(
                        center.x + 145f * scale * cos(radians),
                        center.y + 145f * scale * sin(radians),
                    ),
                )
            }
            cardinalLabels.forEachIndexed { index, label ->
                val radians = (index * 90f - 90f) * PI.toFloat() / 180f
                val labelCenter = Offset(
                    center.x + 88f * scale * cos(radians),
                    center.y + 88f * scale * sin(radians),
                )
                val layout = textMeasurer.measure(label, cardinalStyle)
                drawText(
                    textLayoutResult = layout,
                    topLeft = Offset(
                        labelCenter.x - layout.size.width / 2f,
                        labelCenter.y - layout.size.height / 2f,
                    ),
                )
            }
        }
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .rotate(rotation ?: 0f),
        ) {
            val scale = size.width / 320f
            fun scaledPath(points: List<Pair<Float, Float>>): Path = Path().apply {
                points.forEachIndexed { index, point ->
                    if (index == 0) moveTo(point.first * scale, point.second * scale)
                    else lineTo(point.first * scale, point.second * scale)
                }
                close()
            }
            val north = scaledPath(
                listOf(
                    160f to 42f,
                    171f to 155f,
                    160f to 147f,
                    149f to 155f,
                ),
            )
            val south = scaledPath(
                listOf(
                    160f to 278f,
                    149f to 165f,
                    160f to 173f,
                    171f to 165f,
                ),
            )
            val glow = scaledPath(
                listOf(
                    160f to 35f,
                    174f to 158f,
                    160f to 148f,
                    146f to 158f,
                ),
            )
            if (rotation != null) {
                drawPath(
                    path = glow,
                    color = NaPivoColors.Glow.copy(alpha = 0.08f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(
                        width = 14f * scale,
                        join = StrokeJoin.Round,
                    ),
                )
                drawPath(path = glow, color = NaPivoColors.Glow.copy(alpha = 0.08f))
                drawPath(
                    path = glow,
                    color = NaPivoColors.Glow.copy(alpha = 0.14f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(
                        width = 7f * scale,
                        join = StrokeJoin.Round,
                    ),
                )
                drawPath(path = glow, color = NaPivoColors.Glow.copy(alpha = 0.14f))
                drawPath(path = glow, color = NaPivoColors.Glow.copy(alpha = 0.24f))
            }
            drawPath(
                path = south,
                color = if (rotation == null) Muted.copy(alpha = 0.55f) else NaPivoColors.FoamMuted,
            )
            drawPath(
                path = south,
                color = Ink,
                style = androidx.compose.ui.graphics.drawscope.Stroke(
                    width = 1.5f * scale,
                    join = StrokeJoin.Round,
                ),
            )
            drawPath(
                path = north,
                color = if (rotation == null) Muted else AmberSoft,
            )
            drawPath(
                path = north,
                color = Ink,
                style = androidx.compose.ui.graphics.drawscope.Stroke(
                    width = 2f * scale,
                    join = StrokeJoin.Round,
                ),
            )
        }
        Canvas(modifier = Modifier.fillMaxSize()) {
            val scale = size.width / 320f
            val center = Offset(size.width / 2, size.height / 2)
            drawCircle(color = Ink, radius = 15f * scale, center = center)
            drawCircle(
                color = Amber,
                radius = 15f * scale,
                center = center,
                style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2f * scale),
            )
            drawCircle(color = Amber, radius = 7f * scale, center = center)
        }
    }
}

@Composable
private fun PrimaryAction(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    tag: String,
    modifier: Modifier = Modifier,
    onLongClick: (() -> Unit)? = null,
    compact: Boolean = false,
    singleLine: Boolean = false,
) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        modifier = modifier
            .widthIn(max = 176.dp)
            .fillMaxWidth()
            .shadow(
                elevation = 7.dp,
                shape = shape,
                ambientColor = NaPivoColors.Glow.copy(alpha = 0.5f),
                spotColor = NaPivoColors.Glow.copy(alpha = 0.5f),
            )
            .clip(shape)
            .background(Amber)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .padding(
                horizontal = if (compact) 10.dp else 14.dp,
                vertical = if (compact) 7.dp else 12.dp,
            )
            .testTag(tag),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            color = Ink,
            fontSize = if (singleLine) 12.sp else if (compact) 14.sp else 15.sp,
            fontFamily = Baloo2FontFamily,
            fontWeight = FontWeight.ExtraBold,
            textAlign = TextAlign.Center,
            maxLines = if (singleLine) 1 else 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = subtitle,
            color = Ink.copy(alpha = 0.72f),
            fontSize = if (compact) 9.sp else 10.sp,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center,
            maxLines = if (singleLine) 1 else 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SecondaryAction(
    title: String,
    subtitle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val shape = RoundedCornerShape(20.dp)
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Surface)
            .border(1.dp, NaPivoColors.Border, shape)
            .combinedClickable(onClick = onClick)
            .padding(horizontal = 13.dp, vertical = if (compact) 7.dp else 10.dp),
    ) {
        Text(
            title,
            color = Cream,
            fontSize = if (compact) 12.sp else 13.sp,
            fontFamily = InterFontFamily,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (subtitle.isNotBlank()) {
            Text(
                subtitle,
                color = Muted,
                fontSize = 10.sp,
                fontFamily = InterFontFamily,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SmallAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    accent: Boolean = false,
    compact: Boolean = false,
) {
    // Compose expands pointer-input hit testing to ViewConfiguration's 48.dp
    // minimum without changing measured size. Keep combinedClickable on the
    // compact visual surface so tight round-screen layouts stay unchanged.
    val shape = RoundedCornerShape(18.dp)
    Box(
        modifier = modifier
            .clip(shape)
            .background(if (accent) AmberSoft else Raised)
            .border(
                1.dp,
                if (accent) AmberSoft else NaPivoColors.Border,
                shape,
            )
            .combinedClickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = if (compact) 6.dp else 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            color = if (accent) Ink else Cream,
            fontSize = 11.sp,
            fontFamily = Baloo2FontFamily,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun HeaderAction(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tag: String? = null,
) {
    // combinedClickable receives Compose's automatic 48.dp minimum touch target.
    Text(
        text = text,
        color = AmberSoft,
        fontSize = 11.sp,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .combinedClickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp)
            .then(if (tag == null) Modifier else Modifier.testTag(tag)),
    )
}

@Composable
private fun CompactTextAction(
    text: String,
    onClick: () -> Unit,
    tag: String,
) {
    // combinedClickable receives Compose's automatic 48.dp minimum touch target.
    Text(
        text = text,
        color = AmberSoft,
        fontSize = 9.sp,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier
            .clip(RoundedCornerShape(12.dp))
            .combinedClickable(onClick = onClick)
            .padding(horizontal = 5.dp, vertical = 4.dp)
            .testTag(tag),
    )
}

@Composable
private fun Title(value: String) {
    Text(
        text = value,
        color = Cream,
        fontSize = 22.sp,
        lineHeight = 24.sp,
        fontFamily = Baloo2FontFamily,
        fontWeight = FontWeight.ExtraBold,
        textAlign = TextAlign.Center,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun FullPubTitle(value: String, compact: Boolean = false) {
    val fontSize = when {
        compact && value.length <= 22 -> 15.sp
        compact -> 12.sp
        value.length <= 18 -> 20.sp
        value.length <= 30 -> 17.sp
        else -> 14.sp
    }
    Text(
        text = value,
        color = Cream,
        fontSize = fontSize,
        lineHeight = if (compact) 16.sp else 18.sp,
        fontFamily = Baloo2FontFamily,
        fontWeight = FontWeight.ExtraBold,
        textAlign = TextAlign.Center,
        maxLines = if (compact) 2 else 3,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.width(if (compact) 140.dp else 152.dp),
    )
}

@Composable
private fun Body(value: String) {
    Text(
        text = value,
        color = Muted,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        fontFamily = InterFontFamily,
        textAlign = TextAlign.Center,
    )
}

@Composable
private fun Eyebrow(value: String) {
    val locale = LocalLocale.current.platformLocale
    Text(
        text = value.uppercase(locale),
        color = Amber,
        fontSize = 9.sp,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Bold,
        textAlign = TextAlign.Center,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun SyncLine(state: WearUiState, modifier: Modifier = Modifier) {
    val line = when {
        state.persisted.syncConflict != null -> state.persisted.syncConflict
        state.persisted.outbox.isNotEmpty() && state.connectivity == ConnectivityState.DISCONNECTED ->
            "Offline · ${state.persisted.outbox.size} čeká na odeslání"
        state.persisted.outbox.isNotEmpty() -> "Synchronizuji ${state.persisted.outbox.size} změn"
        state.persisted.isStale -> "Data mohou být starší"
        else -> "Všechno sedí"
    }
    Text(
        text = line,
        color = if (state.persisted.syncConflict != null) Danger else Muted,
        fontSize = 9.sp,
        fontFamily = InterFontFamily,
        fontWeight = FontWeight.Medium,
        textAlign = TextAlign.Center,
        maxLines = 2,
        modifier = modifier,
    )
}

private fun compactSyncText(state: WearUiState): String = when {
    state.persisted.syncConflict != null -> "KONFLIKT"
    state.persisted.outbox.isNotEmpty() && state.connectivity == ConnectivityState.DISCONNECTED ->
        "OFFLINE ${state.persisted.outbox.size}"
    state.persisted.outbox.isNotEmpty() -> "SYNC ${state.persisted.outbox.size}"
    state.persisted.isStale -> "STARŠÍ"
    else -> "✓"
}

private fun formatDistance(meters: Double): String =
    if (meters < 1_000) "${meters.roundToInt()} m"
    else String.format(Locale.getDefault(), "%.1f km", meters / 1_000.0)

private fun beerCountLabel(count: Int): String = when (count) {
    1 -> "PIVO"
    in 2..4 -> "PIVA"
    else -> "PIV"
}

private fun typeLabel(type: DrinkType): String = when (type) {
    DrinkType.BEER -> "Pivo"
    DrinkType.SOFT_DRINK -> "Nealko"
    DrinkType.WINE -> "Víno"
    DrinkType.SHOT -> "Panák"
}

private fun defaultVolume(type: DrinkType): Int = when (type) {
    DrinkType.BEER -> 500
    DrinkType.SOFT_DRINK -> 300
    DrinkType.WINE -> 200
    DrinkType.SHOT -> 40
}

private fun volumePresets(type: DrinkType): List<Int> = when (type) {
    DrinkType.BEER -> listOf(300, 400, 500)
    DrinkType.SOFT_DRINK -> listOf(250, 300, 500)
    DrinkType.WINE -> listOf(100, 150, 200)
    DrinkType.SHOT -> listOf(20, 40, 50)
}

private fun candidateDefinition(drink: DrinkChoice): String = drink.choiceId
