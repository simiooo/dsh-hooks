import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { object } from './protocol.js';
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const versions = (value) => Array.isArray(value) && value.length <= 256 && value.every(hash);
const rules = (value) => object(value) && Object.keys(value).length <= 10_000
    && Object.entries(value).every(([key, rule]) => hash(key) && object(rule) && ['allow', 'deny'].includes(String(rule.decision)) && versions(rule.versions));
const fresh = () => ({ schema: 'dsh-hooks/policy-v1', revision: 'none', defaultAllow: false, global: {}, projects: {}, reviewed: {} });
/** Owner-only Host policy data. Project configuration cannot grant itself execution permission. */
export class PolicyStore {
    directory;
    path;
    tail = Promise.resolve();
    constructor(options) {
        const path = options.permissionsDir ?? join(options.pluginDataRoot ?? join(homedir(), '.dsh', 'hooks-data'), 'permissions');
        this.directory = resolve(path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path);
        this.path = join(this.directory, 'policy.json');
    }
    async read() {
        let text;
        try {
            text = await readFile(this.path, 'utf8');
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return fresh();
            throw error;
        }
        if (Buffer.byteLength(text) > 4 * 1024 * 1024)
            throw new Error('Hook permission policy exceeds 4 MiB');
        const data = JSON.parse(text);
        if (!object(data) || data.schema !== 'dsh-hooks/policy-v1' || typeof data.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(data.revision)
            || typeof data.defaultAllow !== 'boolean' || !rules(data.global) || !object(data.projects) || Object.keys(data.projects).length > 10_000
            || !Object.entries(data.projects).every(([key, value]) => hash(key) && rules(value))
            || !object(data.reviewed) || !Object.entries(data.reviewed).every(([key, value]) => hash(key) && versions(value)))
            throw new Error('Invalid hook permission policy');
        return data;
    }
    async atomic(path, text) {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
            await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
            await rename(temporary, path);
        }
        finally {
            await unlink(temporary).catch(() => { });
        }
    }
    async lock() {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const path = `${this.path}.lock`, identity = JSON.stringify({ pid: process.pid, id: randomUUID() });
        const deadline = Date.now() + 3000;
        for (;;) {
            try {
                const file = await open(path, 'wx', 0o600);
                try {
                    await file.writeFile(identity);
                }
                catch (error) {
                    await file.close();
                    await unlink(path).catch(() => { });
                    throw error;
                }
                await file.close();
                return async () => { if (await readFile(path, 'utf8').catch(() => '') === identity)
                    await unlink(path); };
            }
            catch (error) {
                if (error.code !== 'EEXIST')
                    throw error;
                // A terminated Host must not leave every later settings write permanently locked out.
                const previous = await readFile(path, 'utf8').catch(() => '');
                try {
                    const owner = JSON.parse(previous);
                    if (object(owner) && Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0) {
                        try {
                            process.kill(Number(owner.pid), 0);
                        }
                        catch (dead) {
                            if (dead.code === 'ESRCH') {
                                let recovery;
                                try {
                                    recovery = await open(`${path}.recover`, 'wx', 0o600);
                                    if (await readFile(path, 'utf8').catch(() => '') === previous)
                                        await unlink(path).catch(() => { });
                                }
                                catch (error) {
                                    if (error.code !== 'EEXIST')
                                        throw error;
                                }
                                finally {
                                    if (recovery) {
                                        await recovery.close();
                                        await unlink(`${path}.recover`).catch(() => { });
                                    }
                                }
                            }
                        }
                    }
                }
                catch { /* A Host may still be writing the lock owner. */ }
                if (Date.now() >= deadline)
                    throw new Error('Hook permission policy is busy. Retry.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
        }
    }
    async update(expected, change, current) {
        const work = this.tail.then(async () => {
            const unlock = await this.lock();
            try {
                const before = await this.read();
                if (before.revision !== expected)
                    throw new Error('Hook permissions changed. Refresh before saving.');
                if (!await current())
                    throw new Error('Hooks changed. Refresh before saving.');
                const next = structuredClone(before);
                change(next);
                next.revision = randomUUID();
                const content = JSON.stringify(next, null, 2) + '\n';
                if (Buffer.byteLength(content) > 4 * 1024 * 1024)
                    throw new Error('Hook permission policy exceeds 4 MiB');
                if (!await current())
                    throw new Error('Hooks changed. Refresh before saving.');
                await this.atomic(this.path, content);
                if (!await current()) {
                    if (before.revision === 'none')
                        await unlink(this.path);
                    else
                        await this.atomic(this.path, JSON.stringify(before, null, 2) + '\n');
                    throw new Error('Hook permission update was withdrawn.');
                }
                return next;
            }
            finally {
                await unlock();
            }
        });
        this.tail = work.catch(() => { });
        return work;
    }
    async audit(data, current) {
        const id = randomUUID(), path = join(this.directory, 'audit', `${id}.json`);
        if (!await current())
            throw new Error('Hook permissions changed. Refresh before saving.');
        await this.atomic(path, JSON.stringify({ schema: 'dsh-hooks/policy-intent-v1', phase: 'requested', actor: 'interactive-host-owner', id, at: new Date().toISOString(), ...data }, null, 2));
        if (!await current()) {
            await unlink(path);
            throw new Error('Hook permission update was withdrawn.');
        }
    }
}
//# sourceMappingURL=policy.js.map