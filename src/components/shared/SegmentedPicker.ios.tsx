import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

import type { SegmentedPickerProps } from './SegmentedPicker';

export default function SegmentedPicker({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
  optionTestIDs,
}: SegmentedPickerProps) {
  return (
    <Host matchContents={{ vertical: true }} colorScheme="dark" style={{ alignSelf: 'stretch' }}>
      <Picker
        testID={testID}
        label={accessibilityLabel ?? ''}
        selection={value}
        onSelectionChange={(index: number) => onChange(index)}
        modifiers={[pickerStyle('segmented')]}
      >
        {options.map((label, index) => (
          <Text key={label} testID={optionTestIDs?.[index]} modifiers={[tag(index)]}>
            {label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}
