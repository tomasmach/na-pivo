/**
 * Test mock for expo-clipboard (native module, untranspiled ESM source).
 * ShareNightModal copies the story-sticker PNG through it; under test the
 * copy is a no-op. Tests asserting on clipboard writes can jest.mock further.
 */

export async function setImageAsync(_base64Image: string): Promise<void> {
  // no-op
}

export async function setStringAsync(_content: string): Promise<boolean> {
  return true;
}
