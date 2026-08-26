/**
 * About screen — "O appce".
 *
 * Reached from the Settings "O appce" row. Shows the app identity (brand
 * medallion, name, current version) and the FULL changelog — every published
 * version, newest first — so the user can scroll through every update. The
 * notes come from the same backend that drives the post-update "Co je nového"
 * popup (see releaseNotesClient / WhatsNewModal), via the no-version list shape
 * of GET /v1/release-notes.
 *
 * The changelog is fetched non-blockingly on mount. States:
 *  - 'loading' → in-flight fetch (spinner).
 *  - 'notes'   → render one block per version (empty list → calm empty line).
 *  - 'error'   → offline / dormant backend (a "try again later" line).
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';

import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { leaveRoute } from '@/navigation/leaveRoute';
import { BeerIcon, ChevronLeftIcon, ExternalLinkIcon } from '@/components/shared/IconGlyph';
import { getAppVersionLabel } from '@/utils/appVersion';
import {
  fetchAllReleaseNotes,
  type ReleaseNote,
} from '@/data/releaseNotesClient';
import { openPlayStoreListing } from '@/utils/storeLinks';

type ChangelogState =
  | { kind: 'loading' }
  | { kind: 'notes'; notes: ReleaseNote[] }
  | { kind: 'error' };

export default function AboutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const versionLabel = getAppVersionLabel();
  const [state, setState] = useState<ChangelogState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetchAllReleaseNotes(controller.signal).then((result) => {
      if (!active) return;
      if (result.kind === 'notes') {
        setState({ kind: 'notes', notes: result.notes });
      } else {
        setState({ kind: 'error' });
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={[]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => leaveRoute(router)}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>

        <Text style={styles.headerTitle}>{cs.settings.about.title}</Text>

        {/* Invisible spacer keeps the title centered */}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + Spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Brand hero ── */}
        <View style={styles.hero}>
          <View style={styles.medallion}>
            {/* Drawn glyph, not an emoji (§19). */}
            <BeerIcon size={44} color={Colors.amber} />
          </View>
          <Text style={styles.appName}>{cs.appName}</Text>
          <Text style={styles.tagline}>{cs.about.tagline}</Text>
          {versionLabel ? (
            <View style={styles.versionPill}>
              <Text style={styles.versionText}>{versionLabel}</Text>
            </View>
          ) : null}
        </View>

        {Platform.OS === 'android' ? (
          <Pressable
            onPress={() => void openPlayStoreListing()}
            style={({ pressed }) => [styles.playStoreButton, pressed && styles.pressed]}
            accessibilityRole="link"
            accessibilityLabel="Otevřít Na pivo v Google Play"
          >
            <Text style={styles.playStoreButtonText}>Na pivo v Google Play</Text>
            <ExternalLinkIcon size={17} color={Colors.amber} />
          </Pressable>
        ) : null}

        {/* ── Changelog ── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>{cs.about.whatsNewHeader}</Text>
          <ChangelogBody state={state} />
        </View>

        {/* ── Footer ── */}
        <Text style={styles.footer}>{cs.about.footer}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Renders the changelog body for the resolved fetch state. */
function ChangelogBody({ state }: { state: ChangelogState }) {
  if (state.kind === 'loading') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator color={Colors.amber} />
        <Text style={styles.statusText}>{cs.about.loading}</Text>
      </View>
    );
  }

  if (state.kind === 'notes' && state.notes.length > 0) {
    return (
      <View style={styles.noteList}>
        {state.notes.map((note) => (
          <NoteBlock key={note.version} note={note} />
        ))}
      </View>
    );
  }

  // 'notes' with an empty list (nothing published yet) or 'error' (offline).
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>
        {state.kind === 'notes' ? cs.about.empty : cs.about.error}
      </Text>
    </View>
  );
}

/** One published version: a quiet version label + title, then its highlight rows. */
function NoteBlock({ note }: { note: ReleaseNote }) {
  return (
    <View style={styles.noteBlock}>
      <View style={styles.noteHeader}>
        <Text style={styles.noteTitle} numberOfLines={2}>
          {note.title}
        </Text>
        <Text style={styles.noteVersion}>
          {cs.whatsNew.versionLabel(note.version)}
        </Text>
      </View>

      <View style={styles.list}>
        {note.items.map((item, i) => (
          <View key={i} style={styles.row}>
            <View style={styles.marker}>
              {item.icon ? (
                <Text style={styles.markerIcon}>{item.icon}</Text>
              ) : (
                <View style={styles.diamond} />
              )}
            </View>
            <Text style={styles.itemText}>{item.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.stout,
  },

  // ── Header (mirrors settings.tsx) ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },

  // ── Scroll ──
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: Spacing.xl,
  },

  // ── Brand hero ──
  hero: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  playStoreButton: {
    minHeight: 50,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  playStoreButtonText: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
  },
  pressed: { opacity: 0.72 },
  medallion: {
    width: 88,
    height: 88,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.5),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  appName: {
    fontWeight: '800',
    fontSize: 34,
    lineHeight: 40,
    color: Colors.foam,
  },
  tagline: {
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
    textAlign: 'center',
    maxWidth: 260,
  },
  versionPill: {
    marginTop: Spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  versionText: {
    fontWeight: '600',
    fontSize: 13,
    letterSpacing: 0.3,
    color: Colors.amberLight,
  },

  // ── Section ──
  section: {
    gap: Spacing.md,
  },
  sectionHeader: {
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },

  // ── Status (loading) ──
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  statusText: {
    fontWeight: '400',
    fontSize: 14,
    color: Colors.foamMuted,
  },

  // ── Changelog: per-version blocks ──
  noteList: {
    gap: Spacing.xl,
  },
  noteBlock: {
    gap: Spacing.md,
  },
  noteHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.amber, 0.35),
    paddingBottom: Spacing.sm,
  },
  noteTitle: {
    flex: 1,
    fontWeight: '700',
    fontSize: 18,
    color: Colors.foam,
  },
  noteVersion: {
    fontWeight: '500',
    fontSize: 12,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
    color: Colors.mutedText,
  },

  // ── Note item rows (mirror WhatsNewModal) ──
  list: {
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  marker: {
    width: 26,
    alignItems: 'center',
  },
  markerIcon: {
    fontSize: 18,
    lineHeight: 22,
  },
  diamond: {
    width: 7,
    height: 7,
    marginTop: 8,
    backgroundColor: Colors.amber,
    transform: [{ rotate: '45deg' }],
  },
  itemText: {
    flex: 1,
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
  },

  // ── Empty / error ──
  emptyCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
  },
  emptyText: {
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // ── Footer ──
  footer: {
    fontWeight: '500',
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
