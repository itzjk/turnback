import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { atomicWrite, stat } from './tree.mjs';
import { alive } from './store.mjs';
import { InputGate } from './input.mjs';

export async function watch(store, command) {
  if (!command.length) throw new Error('Usage: turnback watch -- <agent> [arguments]');
  const interactive = Boolean(process.stdin.isTTY);
  if (interactive && !['darwin', 'linux'].includes(process.platform)) throw new Error('Interactive watch supports macOS and Linux. Use checkpoint hooks on this platform.');
  const marker = path.join(store.directory, 'watch.json');
  store.transact(() => {
    if (stat(marker) && alive(JSON.parse(fs.readFileSync(marker, 'utf8')).pid)) throw new Error('A watched agent is already running in this project.');
    atomicWrite(marker, JSON.stringify({ pid: process.pid }));
  });
  let child;
  let failed = false;
  let finished = false;
  let escalation;
  const rawBefore = process.stdin.isRaw;
  const terminate = signal => {
    if (!child) return;
    try { process.kill(-child.pid, signal); } catch {
      try { child.kill(signal); } catch {}
    }
    if (!escalation) escalation = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, 2000).unref();
  };
  const signals = new Map(['SIGTERM', 'SIGHUP', 'SIGINT'].map(signal => [signal, () => terminate(signal)]));
  let onData;
  let onResize;
  try {
    const initial = store.checkpoint('before agent');
    process.stderr.write(`turnback: checkpoint #${initial.id}. Stop the agent, then run turnback undo.\n`);
    const skipped = initial.skipped.filter(name => name !== '.turnback');
    if (skipped.length) process.stderr.write(`turnback: excluded ${skipped.length} paths (dependencies, ignore rules or size/type limits).\n`);
    const pty = interactive ? await import('@lydell/node-pty') : null;
    if (interactive) process.stderr.write('turnback: checkpoint before each Enter; use hooks for exact turn boundaries.\n');
    const result = await new Promise((resolve, reject) => {
      const env = { ...process.env };
      if (interactive) {
        child = pty.spawn(command[0], command.slice(1), { cwd: store.root, env, name: env.TERM || 'xterm-256color', cols: process.stdout.columns || 80, rows: process.stdout.rows || 24, encoding: null });
        child.onData(data => process.stdout.write(data));
        child.onExit(({ exitCode, signal }) => { finished = true; resolve(signal ? 128 + signal : exitCode); });
        onResize = () => {
          try { child.resize(process.stdout.columns || 80, process.stdout.rows || 24); } catch {}
        };
        process.stdout.on('resize', onResize);
      } else {
        child = spawn(command[0], command.slice(1), { cwd: store.root, env, stdio: 'inherit', detached: process.platform !== 'win32' });
        child.once('error', reject);
        child.once('close', (code, signal) => { finished = true; resolve(code ?? 128 + (os.constants.signals[signal] || 1)); });
      }
      if (child.pid) atomicWrite(marker, JSON.stringify({ pid: process.pid, child: child.pid }));
      for (const [signal, listener] of signals) process.on(signal, listener);
      if (interactive) {
        const gate = new InputGate(() => store.checkpoint('before terminal submit'), data => child.write(data));
        onData = chunk => {
          try { gate.write(chunk); } catch (error) {
            failed = true;
            process.stderr.write(`\r\nturnback: checkpoint failed, input was not submitted: ${error.message}\r\n`);
            terminate('SIGTERM');
          }
        };
        process.stdin.setRawMode(true);
        process.stdin.on('data', onData);
        process.stdin.resume();
      }
    });
    return failed ? 1 : result;
  } finally {
    if (child?.pid && !finished) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
    }
    clearTimeout(escalation);
    for (const [signal, listener] of signals) process.removeListener(signal, listener);
    if (onResize) process.stdout.removeListener('resize', onResize);
    if (onData) process.stdin.removeListener('data', onData);
    if (interactive) {
      process.stdin.setRawMode(Boolean(rawBefore));
      process.stdin.pause();
    }
    fs.rmSync(marker, { force: true });
  }
}
