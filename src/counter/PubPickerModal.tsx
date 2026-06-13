/**
 * "Where are you?" picker — a bottom-sheet list of the nearest pubs with
 * distances, used when GPS auto-detect is wrong or the user wants to switch
 * pubs. Plain RN Modal (same pattern as WhatsNewModal / BeerFormModal).
 */

import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { MapPinIcon, XIcon } from '@/components/shared/IconGlyph';
import { formatDistanceCs } from '@/compass/distance';
import { cs } from '@/i18n/cs';
import type { Pub } from '@/data/pubs';
import type { NearbyCandidate } from '@/counter/useNearbyPub';

interface PubPickerModalProps {
  visible: boolean;
  candidates: NearbyCandidate[];
  selectedKey: string | null;
  onSelect: (pub: Pub) => void;
  onClose: () => void;
}

export function PubPickerModal({ visible, candidates, selectedKey, onSelect, onClose }: PubPickerModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.counter.pickerTitle}
            </Text>
            <Pressable
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.counterCloseModal}
            >
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {candidates.map((candidate) => {
              const isSelected = candidate.pubKey === selectedKey;
              const distance = formatDistanceCs(candidate.distanceMeters);
              return (
                <Pressable
                  key={candidate.pubKey}
                  onPress={() => onSelect(candidate.pub)}
                  style={({ pressed }) => [
                    styles.row,
                    isSelected && styles.rowSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={cs.a11y.counterPickPub(candidate.pub.name, distance)}
                >
                  <MapPinIcon size={18} color={isSelected ? Colors.stout : Colors.amber} />
                  <Text
                    style={[styles.rowName, isSelected && styles.rowNameSelected]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {candidate.pub.name}
                  </Text>
                  <Text
                    style={[styles.rowDistance, isSelected && styles.rowDistanceSelected]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {distance}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.7),
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 8,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  rowPressed: {
    opacity: 0.8,
  },
  rowName: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  rowNameSelected: {
    color: Colors.stout,
  },
  rowDistance: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },
  rowDistanceSelected: {
    color: Colors.stout,
  },
});
