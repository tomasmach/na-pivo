/**
 * Test mock for expo-file-system (an ESM/native module Jest cannot load — its
 * source ships untranspiled and pulls in expo-modules-core). auth.ts uses it
 * only to upload an avatar via the native multipart uploader; under test we
 * stub `File.upload` to resolve a 200 so the surrounding logic runs without the
 * device file system. Tests that assert on uploads can jest.mock it further.
 */

export enum UploadType {
  BINARY_CONTENT = 0,
  MULTIPART = 1,
}

interface UploadResult {
  status: number;
  body: string;
  headers: Record<string, string>;
}

export class File {
  readonly uri: string;

  constructor(...uris: (string | { uri: string })[]) {
    this.uri = uris.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
  }

  create(_options?: unknown): void {
    // no-op
  }

  write(_content: string | Uint8Array, _options?: unknown): void {
    // no-op
  }

  async upload(_url: string, _options?: unknown): Promise<UploadResult> {
    return { status: 200, body: '{}', headers: {} };
  }
}

export const Paths = { document: '', cache: '' };
