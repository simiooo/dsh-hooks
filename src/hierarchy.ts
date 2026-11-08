import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { loadSnapshot, projectRoot, sha, type Options, type Snapshot } from './config.js';
import type { Hook } from './protocol.js';
import { PolicyStore, type PermissionChoice, type PermissionRule, type PolicyDocument } from './policy.js';

export interface PermissionRow {
  id: string; version: string; event: string; command: string; source: string; name: string; enabled: boolean;
  choice: PermissionChoice; global: PermissionChoice; project: PermissionChoice;
  effective: 'allow' | 'deny' | 'ask'; from: 'session' | 'project' | 'global' | 'global-default' | 'legacy' | 'default'; reviewRequired: boolean;
}
interface Lease { token: string; version: string; controller: AbortController }
interface Instance {
  cwd: string; project?: string; snapshot?: Snapshot; revision: string; closed: boolean;
  rules: Map<string, PermissionRule>; leases: Map<string, Lease>; denyAll: boolean;
  tail: Promise<unknown>;
}
export class HookPermissions {
  readonly store: PolicyStore;
  private instances = new Map<string, Instance>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private options: Options, private legacy: (cwd: string, snapshot: Snapshot) => Promise<boolean>, private alive: () => boolean) { this.store = new PolicyStore(options); }
  attach(id: string, cwd: string) {
    const state = this.instances.get(id);
    if (state && !state.closed) { if (state.cwd !== cwd) { this.stop(id); state.cwd = cwd; state.revision = randomUUID(); } return; }
    this.instances.set(id, { cwd, revision: randomUUID(), closed: false, rules: new Map(), leases: new Map(), denyAll: false, tail: Promise.resolve() });
  }
  private state(id: string) { const state = this.instances.get(id); if (!state || state.closed || !this.alive()) throw new Error('Hook permission session ended'); return state; }
  private async project(cwd: string) { const path = await realpath(await projectRoot(await realpath(cwd))); return { path, key: sha(path) }; }
  private resolve(hook: Hook, state: Instance | undefined, document: PolicyDocument, project: string, legacy: boolean): PermissionRow {
    const id = hook.permissionId!, version = hook.version!;
    const base = { id, version, event: hook.event, command: hook.command, source: hook.source, name: hook.statusMessage ?? hook.command,
      enabled: true, choice: state?.rules.get(id)?.decision ?? 'inherit', global: document.global[id]?.decision ?? 'inherit', project: document.projects[project]?.[id]?.decision ?? 'inherit' } as const;
    const candidates: ['session' | 'project' | 'global', PermissionRule | undefined][] = [['session', state?.rules.get(id)], ['session', state?.denyAll ? { decision: 'deny', versions: [] } : undefined],
      ['project', document.projects[project]?.[id]], ['global', document.global[id]]];
    for (const [from, rule] of candidates) {
      if (!rule) continue;
      const reviewRequired = rule.decision === 'allow' && !rule.versions.includes(version);
      return { ...base, effective: reviewRequired ? 'ask' : rule.decision, from, reviewRequired };
    }
    if (legacy) return { ...base, effective: 'allow', from: 'legacy', reviewRequired: false };
    const reviewed = document.reviewed[id]?.includes(version) === true;
    return { ...base, effective: document.defaultAllow && reviewed ? 'allow' : 'ask', from: document.defaultAllow ? 'global-default' : 'default', reviewRequired: document.defaultAllow && !reviewed };
  }
  private async view(cwd: string, snapshot: Snapshot, state?: Instance) {
    const [document, project, legacy] = await Promise.all([this.store.read(), this.project(cwd), this.legacy(cwd, snapshot)]);
    if (!this.alive() || state?.closed || (state && state.cwd !== cwd)) throw new Error('Hook permission scope changed');
    if (state && state.project !== undefined && state.project !== project.key) { this.stopInstance(state); state.rules.clear(); state.denyAll = false; state.revision = randomUUID(); }
    if (state) { state.project = project.key; state.snapshot = snapshot; }
    if (state?.denyAll) {
      for (const hook of snapshot.allHooks ?? snapshot.hooks) state.rules.set(hook.permissionId!, { decision: 'deny', versions: [hook.version!] });
      state.denyAll = false; state.revision = randomUUID();
    }
    const rows = (snapshot.allHooks ?? snapshot.hooks).map(hook => ({ ...this.resolve(hook, state, document, project.key, legacy), enabled: snapshot.hooks.some(active => active.id === hook.id) }));
    return { cwd, project: project.path, policyRevision: document.revision, globalDefault: document.defaultAllow, hooks: rows,
      revision: sha(JSON.stringify([snapshot.fingerprint, document.revision, state?.revision ?? '', cwd, project.key])) };
  }
  async catalog(cwd: string, snapshot: Snapshot) { return this.view(cwd, snapshot); }
  async sync(id: string, snapshot: Snapshot) {
    const state = this.state(id), work = state.tail.then(() => this.synchronize(id, snapshot, state));
    state.tail = work.catch(() => {}); return work;
  }
  private async synchronize(id: string, snapshot: Snapshot, expected: Instance) {
    const state = this.state(id), cwd = state.cwd;
    if (state !== expected) throw new Error('Hook permission session changed');
    try {
      const status = await this.view(cwd, snapshot, state);
      const allowed = new Map(status.hooks.filter(row => row.enabled && row.effective === 'allow').map(row => [row.id, row]));
      for (const [key, lease] of state.leases) if (allowed.get(key)?.version !== lease.version) { lease.controller.abort(new Error('Hook changed or permission revoked')); state.leases.delete(key); }
      for (const [key, row] of allowed) if (!state.leases.has(key)) state.leases.set(key, { token: randomUUID(), version: row.version, controller: new AbortController() });
      return status;
    } catch (error) { this.stopInstance(state); throw error; }
  }
  lease(id: string, key: string) { return this.state(id).leases.get(key); }
  active(id: string, token: string) { const state = this.instances.get(id); return !!state && !state.closed && this.alive() && [...state.leases.values()].some(lease => lease.token === token && !lease.controller.signal.aborted); }
  private stopInstance(state: Instance) { for (const lease of state.leases.values()) lease.controller.abort(new Error('Hook work withdrawn')); state.leases.clear(); }
  stop(id: string) { const state = this.instances.get(id); if (state) this.stopInstance(state); }
  detach(id: string) { const state = this.instances.get(id); if (state) { state.closed = true; this.stopInstance(state); this.instances.delete(id); } }
  revoke(id: string) { const state = this.instances.get(id); if (state) { state.rules.clear(); state.denyAll = true; state.revision = randomUUID(); this.stopInstance(state); } }
  reset(id: string) { const state = this.state(id); state.rules.clear(); state.denyAll = false; state.revision = randomUUID(); }
  legacySession(id: string, snapshot: Snapshot, allow: boolean) {
    const state = this.state(id); state.denyAll = !allow;
    for (const hook of snapshot.allHooks ?? snapshot.hooks) state.rules.set(hook.permissionId!, { decision: allow ? 'allow' : 'deny', versions: [hook.version!] });
    state.revision = randomUUID();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> { const work = this.tail.then(operation); this.tail = work.catch(() => {}); return work; }
  async setSession(id: string, expected: string, key: string, choice: PermissionChoice) {
    return this.serial(async () => {
      const state = this.state(id), cwd = state.cwd, snapshot = await loadSnapshot(cwd, this.options), status = await this.sync(id, snapshot);
      if (status.revision !== expected) throw new Error('Hook permissions changed. Refresh before saving.');
      const row = status.hooks.find(row => row.id === key); if (!row) throw new Error('Unknown hook');
      const current = async () => { try { return this.state(id) === state && state.cwd === cwd && (await this.sync(id, await loadSnapshot(cwd, this.options))).revision === expected; } catch { return false; } };
      await this.store.audit({ scope: 'session', sessionId: id, hook: key, version: row.version, choice }, current);
      if (!await current()) throw new Error('Hook permissions changed. Refresh before saving.');
      // An instance stores only explicit overrides. Removing one resumes live inheritance.
      if (choice === 'inherit') state.rules.delete(key); else state.rules.set(key, { decision: choice, versions: [row.version] });
      state.denyAll = false; state.revision = randomUUID();
      return this.sync(id, await loadSnapshot(cwd, this.options));
    });
  }
  async setDurable(cwd: string, snapshot: Snapshot, expected: string, scope: 'global' | 'project', key: string, choice: PermissionChoice, current: () => Promise<boolean>) {
    const hook = (snapshot.allHooks ?? snapshot.hooks).find(hook => hook.permissionId === key); if (!hook) throw new Error('Unknown hook');
    const project = await this.project(cwd);
    const valid = async () => this.alive() && await current() && (await this.project(cwd)).key === project.key;
    await this.store.audit({ scope, project: scope === 'project' ? project.key : undefined, hook: key, version: hook.version, choice }, valid);
    await this.store.update(expected, document => {
      const rules = scope === 'global' ? document.global : document.projects[project.key] ??= {};
      if (choice === 'inherit') delete rules[key];
      else rules[key] = { decision: choice, versions: [...new Set([...(rules[key]?.versions ?? []), hook.version!])].slice(-256) };
    }, valid);
  }
  async setDefault(cwd: string, snapshot: Snapshot, expected: string, enabled: boolean, current: () => Promise<boolean>) {
    const valid = async () => this.alive() && await current();
    await this.store.audit({ scope: 'global-default', enabled, hooks: (snapshot.allHooks ?? snapshot.hooks).map(hook => ({ id: hook.permissionId, version: hook.version })) }, valid);
    await this.store.update(expected, document => {
      document.defaultAllow = enabled;
      if (enabled) for (const hook of snapshot.allHooks ?? snapshot.hooks) document.reviewed[hook.permissionId!] = [...new Set([...(document.reviewed[hook.permissionId!] ?? []), hook.version!])].slice(-256);
    }, valid);
  }
}
