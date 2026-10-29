import { mkdir, readFile, writeFile, access } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';

/**
 * Private object storage port (DOC-04, ADR-009). The production adapter (bank-approved object store with its own encryption and
 * access policy) is [BANK-DECIDES]. There is deliberately no method that returns a URL: bytes leave only through the API.
 */
export abstract class ObjectStore {
  abstract put(key: string, bytes: Buffer): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract exists(key: string): Promise<boolean>;
}

export class UnconfiguredObjectStore extends ObjectStore {
  async put(): Promise<void> { throw new Error('no object store configured'); }
  async get(): Promise<Buffer> { throw new Error('no object store configured'); }
  async exists(): Promise<boolean> { return false; }
}

/** Local-disk adapter for development and tests only. Keys are server-generated; any key that escapes the root is refused. */
export class LocalFsObjectStore extends ObjectStore {
  private readonly root: string;
  constructor(root: string) { super(); this.root = resolve(root); }
  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('invalid storage key');
    return p;
  }
  async put(key: string, bytes: Buffer): Promise<void> { const p = this.path(key); await mkdir(dirname(p), { recursive: true }); await writeFile(p, bytes, { flag: 'wx' }); }
  async get(key: string): Promise<Buffer> { return readFile(this.path(key)); }
  async exists(key: string): Promise<boolean> { try { await access(this.path(key)); return true; } catch { return false; } }
}
