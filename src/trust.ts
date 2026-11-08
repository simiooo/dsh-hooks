import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha, type Options } from './config.js';
import { object } from './protocol.js';

export interface Grant { schema: 'dsh-hooks/trust-v1'; id: string; cwd: string; fingerprint: string; policy: string; grantedAt: string }
/** Independent records avoid losing another directory's grant during concurrent profile writes. */
export class PermanentTrust {
  private tail: Promise<unknown> = Promise.resolve();
  private directory: string;
  constructor(options: Options) {
    const path = options.permissionsDir ?? join(options.pluginDataRoot ?? join(homedir(), '.dsh', 'hooks-data'), 'permissions');
    this.directory = resolve(path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path);
  }
  async scope(cwd: string): Promise<string> { return realpath(resolve(cwd)); }
  private path(cwd: string) { return join(this.directory, `${sha(cwd)}.json`); }
  async get(cwd: string): Promise<Grant | undefined> {
    const canonical = await this.scope(cwd);
    let text: string;
    try { text = await readFile(this.path(canonical), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (text.length > 16_384) throw new Error('Hook permission record is too large');
    const data: unknown = JSON.parse(text);
    if (!object(data) || data.schema !== 'dsh-hooks/trust-v1' || data.cwd !== canonical || typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)
      || typeof data.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.fingerprint)
      || typeof data.policy !== 'string' || !/^[a-f0-9]{64}$/.test(data.policy)
      || typeof data.grantedAt !== 'string' || !Number.isFinite(Date.parse(data.grantedAt))) throw new Error('Invalid hook permission record');
    return data as unknown as Grant;
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work); this.tail = pending.catch(() => {}); return pending;
  }
  async remember(cwd: string, fingerprint: string, policy: string, current: () => Promise<boolean>): Promise<void> {
    return this.serialize(async () => {
      const canonical = await this.scope(cwd), path = this.path(canonical);
      const temporary = `${path}.${randomUUID()}.tmp`;
      const grant: Grant = { schema: 'dsh-hooks/trust-v1', id: randomUUID(), cwd: canonical, fingerprint, policy, grantedAt: new Date().toISOString() };
      const valid = async () => { try { return await current(); } catch { return false; } };
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      try {
        await writeFile(temporary, JSON.stringify(grant, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        if (canonical !== await this.scope(cwd) || !await valid()) throw new Error('Hooks changed or the permission request was withdrawn. Review again.');
        await rename(temporary, path);
        // Cancellation may land during the atomic rename. Do not leave this cancelled grant behind.
        if (!await valid()) {
          const latest = await this.get(cwd);
          if (latest?.id === grant.id) await unlink(path);
          throw new Error('Hook permission request was withdrawn.');
        }
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }
  async forget(cwd: string): Promise<void> {
    return this.serialize(async () => {
      try { await unlink(this.path(await this.scope(cwd))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    });
  }
}
