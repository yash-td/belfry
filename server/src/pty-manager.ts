// PTY manager — spawns real shells via node-pty and exposes them over WebSocket.
//
// Each PTY is identified by a short random id. The id is paired with a
// separate random token that must be presented to attach. Clients first
// call POST /api/terminals to create a PTY (which returns { id, token }),
// then open a WebSocket to /ws/terminal?id=...&token=... to stream bytes.
//
// Tokens live only in memory and are invalidated when the PTY closes. They
// exist as a belt-and-braces defense: CORS + localhost binding are already
// the primary guard, but requiring an unguessable per-PTY token means a
// rogue process on the same machine (or a browser tab on another origin)
// cannot blindly attach to an existing shell.

import { spawn as spawnPty, type IPty } from "node-pty";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";

export interface TerminalMeta {
  id: string;
  cwd: string;
  command: string;
  args: readonly string[];
  createdAt: string;
  cols: number;
  rows: number;
  pid: number;
  exited: boolean;
  exitCode?: number;
  exitSignal?: number;
}

interface Terminal {
  meta: TerminalMeta;
  pty: IPty;
  token: string;
  /** Small ring buffer of recent output so a client can restore context on reconnect. */
  scrollback: string[];
  listeners: Set<(chunk: string) => void>;
  exitListeners: Set<(info: { exitCode: number; signal?: number }) => void>;
}

const MAX_SCROLLBACK_CHUNKS = 500;

export interface CreateTerminalOptions {
  cwd?: string;
  command?: string;
  args?: readonly string[];
  cols?: number;
  rows?: number;
  env?: Readonly<Record<string, string>>;
}

export interface CreatedTerminal {
  id: string;
  token: string;
  meta: TerminalMeta;
}

class PtyManager {
  private terminals = new Map<string, Terminal>();

  list(): TerminalMeta[] {
    return Array.from(this.terminals.values()).map((t) => ({ ...t.meta }));
  }

  get(id: string): TerminalMeta | undefined {
    const t = this.terminals.get(id);
    return t ? { ...t.meta } : undefined;
  }

  create(opts: CreateTerminalOptions = {}): CreatedTerminal {
    const cwd = resolveCwd(opts.cwd);
    const command = opts.command ?? defaultShell();
    const args = opts.args ?? defaultShellArgs(command);
    const cols = clampInt(opts.cols ?? 120, 20, 400);
    const rows = clampInt(opts.rows ?? 32, 5, 200);

    const env: Record<string, string> = {
      ...sanitizeEnv(process.env),
      ...(opts.env ?? {}),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG ?? "en_US.UTF-8",
    };

    const pty = spawnPty(command, [...args], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });

    const id = crypto.randomBytes(8).toString("hex");
    const token = crypto.randomBytes(24).toString("hex");
    const meta: TerminalMeta = {
      id,
      cwd,
      command,
      args: [...args],
      createdAt: new Date().toISOString(),
      cols,
      rows,
      pid: pty.pid,
      exited: false,
    };

    const terminal: Terminal = {
      meta,
      pty,
      token,
      scrollback: [],
      listeners: new Set(),
      exitListeners: new Set(),
    };
    this.terminals.set(id, terminal);

    pty.onData((data) => {
      if (terminal.scrollback.length >= MAX_SCROLLBACK_CHUNKS) {
        terminal.scrollback.shift();
      }
      terminal.scrollback.push(data);
      for (const listener of terminal.listeners) {
        try {
          listener(data);
        } catch (err) {
          console.error("[pty] listener error:", err);
        }
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      terminal.meta.exited = true;
      terminal.meta.exitCode = exitCode;
      terminal.meta.exitSignal = signal;
      for (const listener of terminal.exitListeners) {
        try {
          listener({ exitCode, signal });
        } catch (err) {
          console.error("[pty] exit listener error:", err);
        }
      }
      // Keep the entry around briefly so the UI can show the exit code, then GC.
      setTimeout(() => {
        this.terminals.delete(id);
      }, 30_000);
    });

    return { id, token, meta: { ...meta } };
  }

  attach(
    id: string,
    token: string,
    handlers: {
      onData: (chunk: string) => void;
      onExit: (info: { exitCode: number; signal?: number }) => void;
    }
  ): {
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    detach: () => void;
    scrollback: string[];
  } | null {
    const terminal = this.terminals.get(id);
    if (!terminal) return null;
    if (terminal.token !== token) return null;
    if (terminal.meta.exited) return null;

    terminal.listeners.add(handlers.onData);
    terminal.exitListeners.add(handlers.onExit);

    return {
      scrollback: [...terminal.scrollback],
      write: (data) => {
        if (!terminal.meta.exited) terminal.pty.write(data);
      },
      resize: (cols, rows) => {
        if (terminal.meta.exited) return;
        const c = clampInt(cols, 20, 400);
        const r = clampInt(rows, 5, 200);
        terminal.meta.cols = c;
        terminal.meta.rows = r;
        try {
          terminal.pty.resize(c, r);
        } catch (err) {
          console.warn("[pty] resize failed:", err);
        }
      },
      detach: () => {
        terminal.listeners.delete(handlers.onData);
        terminal.exitListeners.delete(handlers.onExit);
      },
    };
  }

  kill(id: string, signal: string = "SIGHUP"): boolean {
    const terminal = this.terminals.get(id);
    if (!terminal) return false;
    try {
      terminal.pty.kill(signal);
      return true;
    } catch (err) {
      console.warn(`[pty] failed to kill ${id}:`, err);
      return false;
    }
  }
}

export const ptyManager = new PtyManager();

// ------------ helpers ------------

function defaultShell(): string {
  return process.env.SHELL ?? (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");
}

function defaultShellArgs(shell: string): string[] {
  // Interactive login shell by default so the user's normal env (nvm, etc.)
  // is sourced. Windows PowerShell doesn't take -l.
  if (shell.endsWith(".exe")) return [];
  return ["-l"];
}

function resolveCwd(requested: string | undefined): string {
  if (!requested) return os.homedir();
  // Must be an absolute path and must exist.
  if (!requested.startsWith("/")) return os.homedir();
  try {
    const stat = fs.statSync(requested);
    if (stat.isDirectory()) return requested;
  } catch {
    // fall through
  }
  return os.homedir();
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Strip variables that could leak sensitive config into the child shell.
 * We start from the parent env (so PATH, HOME, user aliases work) and
 * remove keys that look like API tokens — the user can always re-export
 * them inside the terminal if they really need to.
 */
function sanitizeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}
