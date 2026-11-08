import { link, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { controlsPath, loadSnapshot, sha, type Options, type Snapshot } from './config.js';
import { object } from './protocol.js';

export interface Scope { id: string; cwd: string }
export interface Catalog {
  revision: string; scopeId: string; scopes: Scope[];
  sources: Snapshot['sources']; issues: string[];
}
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

/** Host-only configuration management. Every write uses an observed revision and an enumerated source. */
export class HooksManagement {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private options: Options, private directories: () => string[], private changed: () => Promise<void>) {}
  private scopes(): Scope[] { return [...new Set(this.directories().map(path => resolve(path)))].map(cwd => ({ id: sha(cwd), cwd })); }
  private scope(id?: string): Scope {
    if (this.closed) throw new Error('Hook management is closed');
    const scopes = this.scopes(); const scope = id === undefined ? scopes[0] : scopes.find(scope => scope.id === id);
    if (!scope) throw new Error('Hook scope is no longer available. Refresh.'); return scope;
  }
  private async snapshot(scopeId?: string) {
    const scope = this.scope(scopeId); const snapshot = await loadSnapshot(scope.cwd, this.options, true);
    this.scope(scope.id); return { scope, snapshot };
  }
  private view(scope: Scope, snapshot: Snapshot): Catalog {
    return { revision: snapshot.fingerprint, scopeId: scope.id, scopes: this.scopes(), sources: snapshot.sources,
      issues: snapshot.diagnostics.filter(issue => !snapshot.sources.some(source => source.issues.includes(issue))) };
  }
  async catalog(scopeId?: string): Promise<Catalog> {
    const { scope, snapshot } = await this.snapshot(scopeId); return this.view(scope, snapshot);
  }
  private check(snapshot: Snapshot, revision: string): void {
    if (snapshot.fingerprint !== revision) throw new Error('Hooks changed. Refresh before saving.');
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(() => { if (this.closed) throw new Error('Hook management is closed'); return work(); });
    this.tail = pending.catch(() => {}); return pending;
  }
  async setEnabled(scopeId: string, revision: string, id: string, enabled: boolean): Promise<Catalog> {
    return this.serialize(async () => {
      const { scope, snapshot } = await this.snapshot(scopeId); this.check(snapshot, revision);
      const hook = snapshot.sources.flatMap(source => source.hooks).find(hook => hook.id === id);
      if (!hook?.supported) throw new Error('This hook cannot be enabled by this Harness version.');
      if (snapshot.diagnostics.some(issue => issue.startsWith('Hooks controls unavailable:'))) throw new Error('Repair the hooks controls file before changing switches.');
      const disabled = new Set(snapshot.disabled); if (enabled) disabled.delete(id); else disabled.add(id);
      if (hook.enabled === enabled) return this.view(scope, snapshot);
      const latest = await this.snapshot(scope.id); this.check(latest.snapshot, revision);
      await this.atomicWrite(controlsPath(this.options), JSON.stringify({ schema: 'dsh-hooks/controls-v1', disabled: [...disabled].sort() }, null, 2) + '\n');
      await this.changed(); return this.catalog(scope.id);
    });
  }
  async readSource(scopeId: string, revision: string, sourceId: string) {
    const { scope, snapshot } = await this.snapshot(scopeId); this.check(snapshot, revision);
    const source = snapshot.sources.find(source => source.id === sourceId); if (!source) throw new Error('Unknown hook source');
    if (source.missing) return { path: source.path, content: source.path.endsWith('.toml') ? '[hooks]\n' : '{\n  "hooks": {}\n}\n', revision, format: source.path.endsWith('.toml') ? 'toml' : 'json' };
    const info = await stat(source.path); if (info.size > MAX_CONFIG_BYTES) throw new Error('Hook configuration exceeds 2 MiB');
    const path = await realpath(source.path); const content = await readFile(path, 'utf8');
    const latest = await this.snapshot(scope.id); this.check(latest.snapshot, revision);
    return { path, content, revision, format: source.path.endsWith('.toml') ? 'toml' : 'json' };
  }
  async writeSource(scopeId: string, revision: string, sourceId: string, content: string): Promise<Catalog> {
    return this.serialize(async () => {
      if (Buffer.byteLength(content) > MAX_CONFIG_BYTES) throw new Error('Hook configuration exceeds 2 MiB');
      const { scope, snapshot } = await this.snapshot(scopeId); this.check(snapshot, revision);
      const source = snapshot.sources.find(source => source.id === sourceId); if (!source) throw new Error('Unknown hook source');
      const raw: unknown = source.path.endsWith('.toml') ? parseToml(content) : JSON.parse(content.replace(/^\uFEFF/, ''));
      if (!object(raw)) throw new Error('Configuration must be an object');
      const prospective = await loadSnapshot(scope.cwd, this.options, true, new Map([[source.path, content]]));
      const errors = prospective.sources.filter(row => row.path === source.path).flatMap(row => row.errors);
      if (errors.length) throw new Error(errors.join('\n'));
      const destination = source.missing ? source.path : await realpath(source.path);
      const mode = source.missing ? 0o600 : (await stat(destination)).mode & 0o777;
      const latest = await this.snapshot(scope.id); this.check(latest.snapshot, revision);
      if (!source.missing && await realpath(source.path) !== destination) throw new Error('Configuration path changed. Refresh.');
      await this.atomicWrite(destination, content, mode, source.missing);
      await this.changed(); return this.catalog(scope.id);
    });
  }
  private async atomicWrite(path: string, content: string, mode = 0o600, create = false): Promise<void> {
    if (this.closed) throw new Error('Hook management is closed');
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
      if (this.closed) throw new Error('Hook management is closed');
      if (create) await link(temporary, path); else await rename(temporary, path);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  async dispose(): Promise<void> { this.closed = true; await this.tail; }
}
