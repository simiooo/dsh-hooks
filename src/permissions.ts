import { randomUUID } from 'node:crypto';
import { EVENTS, object } from './protocol.js';
import type { PermissionRequest, ManualAnswer } from './engine.js';

export function isPermissionRequest(value: unknown): value is PermissionRequest {
  return object(value) && value.schema === 'dsh-hooks/approval-v1' && value.scope === 'session'
    && typeof value.sessionId === 'string' && !!value.sessionId && typeof value.cwd === 'string'
    && typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && Array.isArray(value.hooks) && value.hooks.length > 0 && value.hooks.every(hook => object(hook)
      && EVENTS.includes(hook.event as any) && typeof hook.command === 'string' && !!hook.command.trim()
      && typeof hook.source === 'string' && (hook.statusMessage === undefined || typeof hook.statusMessage === 'string'));
}

/** Host-side human permission queue, exported only through Harness's authenticated Typert Gateway. */
interface PermissionActions {
  revoke(sessionId: string): void;
  remember(request: PermissionRequest, signal: AbortSignal): Promise<void>;
  status(sessionId: string): Promise<unknown>;
  forget(sessionId: string): Promise<void>;
  answerManual(request: ManualAnswer): Promise<boolean>;
}
type Decision = 'allow-session' | 'allow-permanent' | 'deny';
export async function installPermissionApi(ctx: any, actions: PermissionActions): Promise<void> {
  const { TypertRemoteService, Remote } = await import('@deepseek-ai/dsh-typert-protocol');
  type Pending = { id: string; request: PermissionRequest; finish(decision: Decision): Promise<boolean>; cancel(): void };
  const pending = new Map<string, Pending>();
  const sessionId = (request: unknown): string => {
    if (!object(request) || typeof request.sessionId !== 'string' || !request.sessionId) throw new TypeError('sessionId is required');
    return request.sessionId;
  };
  const resources = { session: (request: unknown) => sessionId(request) };
  class HooksPermissions extends TypertRemoteService {
    constructor() { super(ctx, 'dshHooksPermissions'); }
    private owner(): void {
      const invocation = this.ctx.invocation;
      if (invocation?.peer?.principal?.kind !== 'owner' || invocation.peer.interactions !== 'answer') throw new Error('Only the interactive Host owner may review executable hooks');
    }
    @Remote({ resources })
    async list(request: unknown) {
      this.owner(); const id = sessionId(request);
      return { requests: [...pending.values()].filter(p => p.request.sessionId === id).map(p => ({ ...p.request, id: p.id })), status: await actions.status(id) };
    }
    @Remote({ resources })
    async answer(request: unknown) {
      this.owner(); const sid = sessionId(request);
      if (!object(request) || typeof request.id !== 'string' || !request.id || typeof request.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(request.fingerprint) || typeof request.decision !== 'string' || !['allow-session', 'allow-permanent', 'deny'].includes(request.decision)) throw new TypeError('invalid hook decision');
      const entry = pending.get(request.id);
      if (!entry && request.id.startsWith('manual:')) {
        const accepted = await actions.answerManual({ sessionId: sid, id: request.id, fingerprint: request.fingerprint, decision: request.decision as Decision });
        if (accepted) for (const queued of [...pending.values()]) {
          if (queued.request.sessionId === sid && queued.request.fingerprint === request.fingerprint) await queued.finish(request.decision === 'deny' ? 'deny' : 'allow-session');
        }
        return { accepted };
      }
      if (!entry || entry.request.sessionId !== sid || entry.request.fingerprint !== request.fingerprint) return { accepted: false };
      return { accepted: await entry.finish(request.decision as Decision) };
    }
    @Remote({ resources })
    revoke(request: unknown) {
      this.owner(); actions.revoke(sessionId(request)); return { revoked: true };
    }
    @Remote({ resources })
    status(request: unknown) {
      this.owner(); return actions.status(sessionId(request));
    }
    @Remote({ resources })
    async forget(request: unknown) {
      this.owner(); await actions.forget(sessionId(request)); return { revoked: true };
    }
  }
  new HooksPermissions();
  ctx.on('approval/request', (native: any, next: () => Promise<string>) => {
    if (native.toolName !== 'dsh-hooks') return next();
    let request: unknown;
    try { request = JSON.parse(native.reason); } catch { return next(); }
    if (!isPermissionRequest(request) || request.sessionId !== native.agent?.id) return next();
    const review = request;
    return new Promise<string>(resolve => {
      const id = randomUUID();
      let saving = false;
      const settle = (allowed: boolean) => {
        if (!pending.delete(id)) return;
        native.signal?.removeEventListener('abort', abort);
        resolve(allowed ? 'allowed-once' : 'rejected');
      };
      const finish = async (decision: Decision): Promise<boolean> => {
        if (!pending.has(id) || saving) return false;
        saving = true;
        try {
          if (decision === 'allow-permanent') await actions.remember(review, native.signal);
          if (!pending.has(id) || native.signal?.aborted) return false;
          settle(decision !== 'deny'); return true;
        } finally { saving = false; }
      };
      const abort = () => settle(false);
      pending.set(id, { id, request: review, finish, cancel: abort });
      native.signal?.addEventListener('abort', abort, { once: true });
      if (native.signal?.aborted) abort();
    });
  }, { prepend: true });
  ctx.effect(() => () => { for (const entry of [...pending.values()]) entry.cancel(); }, 'dsh-hooks: withdraw permission requests');
}
