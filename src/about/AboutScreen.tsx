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
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { getAppVersionLabel } from '@/utils/appVersion';
import {
  fetchAllReleaseNotes,
  type ReleaseNote,
} from '@/data/releaseNotesClient';

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
          onPress={() => router.back()}
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
            <Text style={styles.medallionEmoji}>🍺</Text>
          </View>
          <Text style={styles.appName}>{cs.appName}</Text>
          <Text style={styles.tagline}>{cs.about.tagline}</Text>
          {versionLabel ? (
            <View style={styles.versionPill}>
              <Text style={styles.versionText}>{versionLabel}</Text>
            </View>
          ) : null}
        </View>

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

/** One published version: a version badge + title, then its highlight rows. */
function NoteBlock({ note }: { note: ReleaseNote }) {
  return (
    <View style={styles.noteBlock}>
      <View style={styles.noteHeader}>
        <View style={styles.versionBadge}>
          <Text style={styles.versionBadgeText}>
            {cs.whatsNew.versionLabel(note.version)}
          </Text>
        </View>
        <Text style={styles.noteTitle} numberOfLines={2}>
          {note.title}
        </Text>
      </View>

      <View style={styles.list}>
        {note.items.map((item, i) => (
          <View key={i} style={styles.row}>
            <View style={styles.chip}>
              {item.icon ? (
                <Text style={styles.chipIcon}>{item.icon}</Text>
              ) : (
                <View style={styles.bullet} />
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
    fontFamily: Fonts.display.extrabold,
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
  medallionEmoji: {
    fontSize: 44,
    lineHeight: 52,
  },
  appName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 34,
    lineHeight: 40,
    color: Colors.foam,
  },
  tagline: {
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    letterSpacing: 0.3,
    color: Colors.amberLight,
  },

  // ── Section ──
  section: {
    gap: Spacing.md,
  },
  sectionHeader: {
    fontFamily: Fonts.ui.bold,
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
    fontFamily: Fonts.ui.regular,
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
    alignItems: 'center',
    gap: Spacing.sm,
  },
  versionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  versionBadgeText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 0.3,
    color: Colors.amberLight,
  },
  noteTitle: {
    flex: 1,
    fontFamily: Fonts.display.bold,
    fontSize: 18,
    color: Colors.foam,
  },

  // ── Note item rows (mirror WhatsNewModal) ──
  list: {
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipIcon: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  itemText: {
    flex: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 21,
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
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
  },

  // ── Footer ──
  footer: {
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
