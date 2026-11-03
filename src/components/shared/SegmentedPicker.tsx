

export interface SegmentedPickerProps {
  options: readonly string[];
  /** Selected segment index. */
  value: number;
  onChange: (index: number) => void;
  accessibilityLabel?: string;
  testID?: string;
  /** One per option, same order. */
  optionTestIDs?: readonly string[];
}
