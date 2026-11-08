import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha } from './config.js';
import { object } from './protocol.js';
/** Independent records avoid losing another directory's grant during concurrent profile writes. */
export class PermanentTrust {
    tail = Promise.resolve();
    directory;
    constructor(options) {
        const path = options.permissionsDir ?? join(options.pluginDataRoot ?? join(homedir(), '.dsh', 'hooks-data'), 'permissions');
        this.directory = resolve(path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path);
    }
    async scope(cwd) { return realpath(resolve(cwd)); }
    path(cwd) { return join(this.directory, `${sha(cwd)}.json`); }
    async get(cwd) {
        const canonical = await this.scope(cwd);
        let text;
        try {
            text = await readFile(this.path(canonical), 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return;
            throw error;
        }
        if (text.length > 16_384)
            throw new Error('Hook permission record is too large');
        const data = JSON.parse(text);
        if (!object(data) || data.schema !== 'dsh-hooks/trust-v1' || data.cwd !== canonical || typeof data.id !== 'string' || !/^[a-f0-9-]{36}$/.test(data.id)
            || typeof data.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(data.fingerprint)
            || typeof data.policy !== 'string' || !/^[a-f0-9]{64}$/.test(data.policy)
            || typeof data.grantedAt !== 'string' || !Number.isFinite(Date.parse(data.grantedAt)))
            throw new Error('Invalid hook permission record');
        return data;
    }
    serialize(work) {
        const pending = this.tail.then(work);
        this.tail = pending.catch(() => { });
        return pending;
    }
    async remember(cwd, fingerprint, policy, current) {
        return this.serialize(async () => {
            const canonical = await this.scope(cwd), path = this.path(canonical);
            const temporary = `${path}.${randomUUID()}.tmp`;
            const grant = { schema: 'dsh-hooks/trust-v1', id: randomUUID(), cwd: canonical, fingerprint, policy, grantedAt: new Date().toISOString() };
            const valid = async () => { try {
                return await current();
            }
            catch {
                return false;
            } };
            await mkdir(this.directory, { recursive: true, mode: 0o700 });
            try {
                await writeFile(temporary, JSON.stringify(grant, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
                if (canonical !== await this.scope(cwd) || !await valid())
                    throw new Error('Hooks changed or the permission request was withdrawn. Review again.');
                await rename(temporary, path);
                // Cancellation may land during the atomic rename. Do not leave this cancelled grant behind.
                if (!await valid()) {
                    const latest = await this.get(cwd);
                    if (latest?.id === grant.id)
                        await unlink(path);
                    throw new Error('Hook permission request was withdrawn.');
                }
            }
            finally {
                await unlink(temporary).catch(() => { });
            }
        });
    }
    async forget(cwd) {
        return this.serialize(async () => {
            try {
                await unlink(this.path(await this.scope(cwd)));
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        });
    }
    /** Records the owner's explicit intent; only a matching live engine or durable grant can execute it. */
    async recordDecision(request, current) {
        return this.serialize(async () => {
            const directory = join(this.directory, 'audit'), id = randomUUID(), path = join(directory, `${id}.json`), temporary = `${path}.tmp`;
            const record = { schema: 'dsh-hooks/owner-decision-v1', id, actor: 'interactive-host-owner', phase: 'requested', at: new Date().toISOString(),
                cwd: await this.scope(request.cwd), sessionId: request.sessionId, fingerprint: request.fingerprint, reviewId: request.id, decision: request.decision };
            const valid = async () => { try {
                return await current();
            }
            catch {
                return false;
            } };
            await mkdir(directory, { recursive: true, mode: 0o700 });
            try {
                await writeFile(temporary, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
                if (!await valid())
                    throw new Error('Hook review changed. Reopen it before approving.');
                await rename(temporary, path);
                if (!await valid()) {
                    await unlink(path);
                    throw new Error('Hook review was withdrawn.');
                }
            }
            finally {
                await unlink(temporary).catch(() => { });
            }
        });
    }
}
//# sourceMappingURL=trust.js.map