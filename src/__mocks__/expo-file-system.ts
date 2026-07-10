/**
 * Test mock for expo-file-system (an ESM/native module Jest cannot load — its
 * source ships untranspiled and pulls in expo-modules-core). auth.ts /
 * menuScanClient / beerPhotosClient use it to upload via the native multipart
 * uploader, and beerPhotosQueue uses File/Directory/Paths to persist diary
 * JPEGs; under test we stub the operations as cheap no-ops so the surrounding
 * logic runs without the device file system. Tests that assert on uploads or
 * file ops can jest.mock it further.
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

type UriPart = string | { uri: string };

function joinUri(uris: UriPart[]): string {
  return uris.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
}

export class Directory {
  readonly uri: string;
  exists = true;

  constructor(...uris: UriPart[]) {
    this.uri = joinUri(uris);
  }

  create(_options?: unknown): void {
    // no-op
  }

  delete(): void {
    // no-op
  }
}

export class File {
  readonly uri: string;
  exists = true;

  constructor(...uris: UriPart[]) {
    this.uri = joinUri(uris);
  }

  create(_options?: unknown): void {
    // no-op
  }

  write(_content: string | Uint8Array, _options?: unknown): void {
    // no-op
  }

  async copy(_destination: unknown): Promise<void> {
    // no-op
  }

  delete(): void {
    // no-op
  }

  async upload(_url: string, _options?: unknown): Promise<UploadResult> {
    return { status: 200, body: '{}', headers: {} };
  }
}

export const Paths = {
  document: new Directory('file:///mock-documents'),
  cache: new Directory('file:///mock-cache'),
};
