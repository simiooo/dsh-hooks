import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { EVENTS, object, type EventName, type Hook } from './protocol.js';

export interface Options {
  configPaths?: string[];
  codexHome?: string;
  discover?: boolean;
  pluginRoots?: string[];
  watchPaths?: string[];
  pollIntervalMs?: number;
  defaultTimeoutMs?: number;
  permissionTimeoutMs?: number;
  maxStopContinuations?: number;
  maxOutputBytes?: number;
  /** Set posix for a POSIX/SSH executor hosted by Windows. Auto uses the host platform. */
  shellFlavor?: 'auto' | 'powershell' | 'posix';
  pluginDataRoot?: string;
}
export interface Snapshot { hooks: Hook[]; fingerprint: string; files: string[]; diagnostics: string[] }
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export { sha };
const expandHome = (p: string) => p.startsWith('~/') || p.startsWith('~\\') ? join(homedir(), p.slice(2)) : p;

export function parseHooks(raw: unknown, source: string, env: Record<string, string> = {}, platform = process.platform): { hooks: Hook[]; diagnostics: string[] } {
  if (!object(raw) || !object(raw.hooks)) throw new Error(`${source}: expected a hooks object`);
  const hooks: Hook[] = [], diagnostics: string[] = [];
  for (const [event, groups] of Object.entries(raw.hooks)) {
    if (!EVENTS.includes(event as EventName)) { diagnostics.push(`${source}: unsupported event ${event}`); continue; }
    if (!Array.isArray(groups)) throw new Error(`${source}: ${event} must be an array`);
    for (const group of groups) {
      if (!object(group) || !Array.isArray(group.hooks)) throw new Error(`${source}: invalid ${event} group`);
      const matcher = ['UserPromptSubmit', 'Stop', 'Interrupt'].includes(event) ? undefined : group.matcher;
      if (matcher !== undefined && typeof matcher !== 'string') throw new Error(`${source}: matcher must be a string`);
      if (typeof matcher === 'string' && matcher !== '*' && matcher !== '') new RegExp(matcher);
      for (const rawHook of group.hooks) {
        if (!object(rawHook)) throw new Error(`${source}: invalid handler`);
        if (rawHook.type !== 'command') { diagnostics.push(`${source}: skipping ${String(rawHook.type)} handler on ${event}`); continue; }
        const windowsCommand = rawHook.commandWindows ?? rawHook.command_windows;
        const command = platform === 'win32' && typeof windowsCommand === 'string' ? windowsCommand : rawHook.command;
        if (typeof command !== 'string' || !command.trim()) throw new Error(`${source}: command must be nonempty`);
        const timeout = rawHook.timeout ?? rawHook.timeoutSec;
        if (timeout !== undefined && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0 || timeout * 1000 > 2_147_483_647)) throw new Error(`${source}: timeout must be positive timer-safe seconds`);
        if (rawHook.async !== undefined && typeof rawHook.async !== 'boolean') throw new Error(`${source}: async must be boolean`);
        const limit = rawHook.additionalContextLimit ?? 2500;
        if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 0) throw new Error(`${source}: invalid additionalContextLimit`);
        hooks.push({ event: event as EventName, command, async: rawHook.async === true && event !== 'SessionEnd', source, env,
          additionalContextLimit: limit, ...(matcher === undefined ? {} : { matcher: matcher as string }),
          ...(timeout === undefined ? {} : { timeout: timeout as number }),
          ...(typeof rawHook.statusMessage === 'string' ? { statusMessage: rawHook.statusMessage } : {}),
        });
      }
    }
  }
  return { hooks, diagnostics };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
export async function projectRoot(cwd: string): Promise<string> {
  let at = resolve(cwd);
  for (;;) { if (await exists(join(at, '.git'))) return at; const parent = dirname(at); if (parent === at) return resolve(cwd); at = parent; }
}

/** Content hashing rather than mtime detects atomic saves and same-size replacements. */
export async function loadSnapshot(cwd: string, options: Options = {}): Promise<Snapshot> {
  const platform = options.shellFlavor === 'posix' ? 'linux' : options.shellFlavor === 'powershell' ? 'win32' : process.platform;
  const hooks: Hook[] = [], diagnostics: string[] = [], content = new Map<string, string | undefined>();
  const record = async (file: string, required = false): Promise<string | undefined> => {
    const path = resolve(expandHome(file));
    if (content.has(path)) return content.get(path);
    try { const text = await readFile(path, 'utf8'); content.set(path, text); return text; }
    catch (error) { if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') { content.set(path, undefined); return undefined; } throw error; }
  };
  const added = new Set<string>();
  const read = async (file: string, env: Record<string, string> = {}, required = false) => {
    const path = resolve(expandHome(file));
    if (added.has(path)) return;
    added.add(path);
    const text = await record(path, required);
    if (text === undefined) return;
    const raw = path.endsWith('.toml') ? parseToml(text) : JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
    // Ordinary Codex config.toml files need not have a hooks table.
    if (path.endsWith('.toml') && object(raw) && raw.hooks === undefined) return;
    const result = parseHooks(raw, path, env, platform);
    hooks.push(...result.hooks); diagnostics.push(...result.diagnostics);
  };
  if (options.discover !== false) {
    const home = resolve(expandHome(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')));
    await read(join(home, 'hooks.json')); await read(join(home, 'config.toml'));
    const root = await projectRoot(cwd);
    const dirs: string[] = []; let at = resolve(cwd);
    for (;;) { dirs.unshift(at); if (at === root || dirname(at) === at) break; at = dirname(at); }
    for (const dir of dirs) { await read(join(dir, '.codex', 'hooks.json')); await read(join(dir, '.codex', 'config.toml')); }
  }
  for (const file of options.configPaths ?? []) await read(isAbsolute(file) ? file : resolve(cwd, file), {}, true);
  for (const plugin of options.pluginRoots ?? []) {
    const root = await realpath(resolve(expandHome(plugin)));
    const manifestPath = await exists(join(root, 'plugin.json')) ? join(root, 'plugin.json') : join(root, '.codex-plugin', 'plugin.json');
    const text = await record(manifestPath);
    const manifest: unknown = text === undefined ? {} : JSON.parse(text);
    let declared: unknown;
    if (object(manifest)) {
      const ext = object(manifest.extensions) ? manifest.extensions['com.openai'] : undefined;
      declared = object(ext) ? ext.hooks : undefined;
      if (declared === undefined) declared = manifest.hooks;
    }
    const data = join(resolve(expandHome(options.pluginDataRoot ?? join(homedir(), '.dsh', 'hooks-data'))), sha(root).slice(0, 24));
    const env = { PLUGIN_ROOT: root, PLUGIN_DATA: data, CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data };
    const entries = declared === undefined ? ['./hooks/hooks.json'] : Array.isArray(declared) ? declared : [declared];
    for (const entry of entries) {
      if (typeof entry === 'string') {
        if (!entry.startsWith('./')) throw new Error(`${manifestPath}: hook paths must start with ./`);
        const file = resolve(root, entry);
        const rel = relative(root, file);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('plugin hook path escapes root');
        if (await exists(file)) {
          const actual = relative(root, await realpath(file));
          if (actual === '..' || actual.startsWith(`..${sep}`) || isAbsolute(actual)) throw new Error('plugin hook symlink escapes root');
        }
        await read(file, env, declared !== undefined);
      } else {
        const parsed = parseHooks(entry, manifestPath, env, platform); hooks.push(...parsed.hooks); diagnostics.push(...parsed.diagnostics);
      }
    }
  }
  // Track directly referenced script files. Imported modules/data are declared with watchPaths.
  for (const hook of hooks) {
    const expanded = hook.command.replace(/\$\{(PLUGIN_ROOT|CLAUDE_PLUGIN_ROOT)\}/g, (_, key: string) => hook.env[key] ?? '');
    const tokens = expanded.match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? [];
    for (const token of tokens) {
      const path = token.replace(/^["']|["']$/g, '');
      if (/\.(?:[cm]?[jt]s|py|sh|bash|ps1|cmd|bat)$/.test(path)) await record(resolve(cwd, path));
    }
  }
  for (const path of options.watchPaths ?? []) await record(resolve(cwd, expandHome(path)));
  const fingerprint = sha(JSON.stringify([...content].sort(([a], [b]) => a.localeCompare(b))));
  return { hooks, diagnostics, fingerprint, files: [...content.keys()] };
}
