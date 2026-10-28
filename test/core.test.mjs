import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../lib/store.mjs';
import { InputGate } from '../lib/input.mjs';
import { hash } from '../lib/tree.mjs';

const cli = fileURLToPath(new URL('../bin/turnback.mjs', import.meta.url));

function workspace(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'turnback-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  };
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  return { root, write, run, read: name => fs.readFileSync(path.join(root, name), 'utf8') };
}

function directoryBytes(root) {
  const result = {};
  function visit(directory, prefix) {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) visit(file, relative);
      else result[relative] = hash(fs.readFileSync(file));
    }
  }
  visit(root, '');
  return result;
}

test('undo and redo restore edits, deletions, new files and git-ignored secrets without changing .git', t => {
  const w = workspace(t);
  spawnSync('git', ['init', '-q'], { cwd: w.root });
  w.write('.gitignore', '.env\n');
  w.write('.env', 'TOKEN=local-example\n');
  w.write('app.txt', 'working\n');
  w.write('deleted.txt', 'keep me\n');
  spawnSync('git', ['add', '.'], { cwd: w.root });
  const gitBefore = directoryBytes(path.join(w.root, '.git'));
  w.run('checkpoint', 'before agent');
  w.write('app.txt', 'broken\n');
  w.write('.env', 'TOKEN=broken\n');
  fs.unlinkSync(path.join(w.root, 'deleted.txt'));
  w.write('new.txt', 'new\n');
  const diff = w.run('diff');
  assert.match(diff, /app.txt/);
  assert.match(diff, /-working\n\+broken/);
  assert.match(w.run('undo'), /Restored #1/);
  assert.equal(w.read('app.txt'), 'working\n');
  assert.equal(w.read('.env'), 'TOKEN=local-example\n');
  assert.equal(w.read('deleted.txt'), 'keep me\n');
  assert.equal(fs.existsSync(path.join(w.root, 'new.txt')), false);
  w.run('redo');
  assert.equal(w.read('app.txt'), 'broken\n');
  assert.equal(w.read('.env'), 'TOKEN=broken\n');
  assert.equal(fs.existsSync(path.join(w.root, 'deleted.txt')), false);
  assert.equal(w.read('new.txt'), 'new\n');
  w.run('list');
  w.run('restore', '1');
  assert.deepEqual(directoryBytes(path.join(w.root, '.git')), gitBefore);
});

test('multiple undo steps, redo, explicit restore and undo of restore preserve intervening work', t => {
  const w = workspace(t);
  for (const value of ['one', 'two', 'three']) {
    w.write('a', value);
    w.run('checkpoint', value);
  }
  w.run('undo');
  assert.equal(w.read('a'), 'two');
  w.run('undo');
  assert.equal(w.read('a'), 'one');
  w.run('redo');
  assert.equal(w.read('a'), 'two');
  w.write('a', 'unsaved');
  w.run('restore', '3');
  assert.equal(w.read('a'), 'three');
  w.run('undo');
  assert.equal(w.read('a'), 'unsaved');
});

test('watch protects a failing noninteractive agent and preserves its exit code', t => {
  const w = workspace(t);
  w.write('app', 'good');
  const result = spawnSync(process.execPath, [cli, 'watch', '--', process.execPath, '-e', "require('fs').writeFileSync('app','bad');process.exit(7)"], { cwd: w.root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 7, result.stderr);
  w.run('undo');
  assert.equal(w.read('app'), 'good');
  w.run('redo');
  assert.equal(w.read('app'), 'bad');
});

test('excluded dependencies, large files and symlink targets survive restoration', t => {
  const w = workspace(t);
  w.write('node_modules/pkg/index.js', 'dependency');
  w.write('large.bin', Buffer.alloc(10 * 1024 * 1024 + 1));
  w.write('app', 'one');
  w.write('outside/value', 'external');
  fs.symlinkSync('outside/value', path.join(w.root, 'link'));
  w.run('checkpoint');
  w.write('node_modules/pkg/index.js', 'updated');
  fs.unlinkSync(path.join(w.root, 'link'));
  w.write('link', 'ordinary file');
  w.write('app', 'two');
  w.run('undo');
  assert.equal(w.read('node_modules/pkg/index.js'), 'updated');
  assert.equal(fs.lstatSync(path.join(w.root, 'link')).isSymbolicLink(), true);
  assert.equal(w.read('outside/value'), 'external');
  assert.equal(fs.statSync(path.join(w.root, 'large.bin')).size, 10 * 1024 * 1024 + 1);
});

test('file/directory transitions, empty directories, executable bits and binary contents round trip', t => {
  const w = workspace(t);
  w.write('item/child', 'child');
  w.write('executable', '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(w.root, 'executable'), 0o755);
  fs.mkdirSync(path.join(w.root, 'empty'));
  w.write('bytes', Buffer.from([0, 255, 17]));
  w.run('checkpoint');
  fs.rmSync(path.join(w.root, 'item'), { recursive: true });
  w.write('item', 'now a file');
  fs.chmodSync(path.join(w.root, 'executable'), 0o644);
  fs.rmdirSync(path.join(w.root, 'empty'));
  w.write('bytes', Buffer.from([9, 8]));
  w.run('undo');
  assert.equal(w.read('item/child'), 'child');
  assert.equal(fs.statSync(path.join(w.root, 'executable')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(w.root, 'empty')).isDirectory(), true);
  assert.deepEqual(fs.readFileSync(path.join(w.root, 'bytes')), Buffer.from([0, 255, 17]));
  w.run('redo');
  assert.equal(w.read('item'), 'now a file');
});

test('restoring through a replaced symlink never writes outside the project', t => {
  const w = workspace(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'turnback-external-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(external, 'child'), 'outside');
  w.write('dir/child', 'inside');
  w.run('checkpoint');
  fs.rmSync(path.join(w.root, 'dir'), { recursive: true });
  fs.symlinkSync(external, path.join(w.root, 'dir'));
  w.run('undo');
  assert.equal(w.read('dir/child'), 'inside');
  assert.equal(fs.readFileSync(path.join(external, 'child'), 'utf8'), 'outside');
  w.run('redo');
  assert.equal(fs.readlinkSync(path.join(w.root, 'dir')), external);
});

test('changed ignore rules refuse an overwrite before changing any file', t => {
  const w = workspace(t);
  w.write('a', 'one');
  w.run('checkpoint');
  w.write('a', 'two');
  w.write('.turnbackignore', 'a\n');
  const result = spawnSync(process.execPath, [cli, 'undo'], { cwd: w.root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /excluded path/);
  assert.equal(w.read('a'), 'two');
  assert.equal(w.read('.turnbackignore'), 'a\n');
});

test('an oversized replacement cannot silently disappear on undo', t => {
  const w = workspace(t);
  w.write('a', 'small');
  w.run('checkpoint');
  w.write('a', Buffer.alloc(10 * 1024 * 1024 + 1));
  const result = spawnSync(process.execPath, [cli, 'undo'], { cwd: w.root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /excluded path/);
  assert.equal(fs.statSync(path.join(w.root, 'a')).size, 10 * 1024 * 1024 + 1);
});

test('ignored children block destructive directory replacement', t => {
  const w = workspace(t);
  w.write('item', 'file');
  w.run('checkpoint');
  fs.unlinkSync(path.join(w.root, 'item'));
  w.write('item/node_modules/keep', 'dependency');
  const result = spawnSync(process.execPath, [cli, 'undo'], { cwd: w.root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /excluded files/);
  assert.equal(w.read('item/node_modules/keep'), 'dependency');
});

test('restoring an older tree preserves current exclusion rules and newly excluded files', t => {
  const w = workspace(t);
  w.write('a', 'before');
  w.run('checkpoint');
  w.write('a', 'after');
  w.write('.turnbackignore', 'private-file\n');
  w.write('private-file', 'must survive');
  const result = spawnSync(process.execPath, [cli, 'undo'], { cwd: w.root, encoding: 'utf8' });
  assert.equal(fs.existsSync(path.join(w.root, 'private-file')), true, 'An excluded file was deleted during restore or rollback.');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(w.read('private-file'), 'must survive');
  assert.equal(w.read('.turnbackignore'), 'private-file\n');
  assert.equal(w.read('a'), 'before');
});

test('corrupt content blocks restore before deleting new work', t => {
  const w = workspace(t);
  w.write('a', 'before');
  w.run('checkpoint');
  w.write('a', 'after');
  w.write('new', 'valuable');
  const object = path.join(w.root, '.turnback', 'objects', hash(Buffer.from('before')));
  fs.writeFileSync(object, 'corrupted');
  const result = spawnSync(process.execPath, [cli, 'undo'], { cwd: w.root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Corrupt object/);
  assert.equal(w.read('new'), 'valuable');
  assert.equal(w.read('a'), 'after');
});

test('malicious snapshot paths are rejected without writing outside the tree', t => {
  const w = workspace(t);
  w.write('a', 'before');
  w.run('checkpoint');
  const manifest = path.join(w.root, '.turnback', 'snapshots', '1.json');
  const tree = JSON.parse(fs.readFileSync(manifest));
  tree[0].path = '../escape';
  fs.writeFileSync(manifest, JSON.stringify(tree));
  const result = spawnSync(process.execPath, [cli, 'restore', '1'], { cwd: w.root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsafe path/);
  assert.equal(w.read('a'), 'before');
});

test('a failed write rolls back, keeping safety content and navigation recoverable', t => {
  const w = workspace(t);
  w.write('a', 'before');
  w.run('checkpoint');
  w.write('a', 'current');
  w.write('new', 'valuable');
  const rename = fs.renameSync;
  let injected = false;
  fs.renameSync = (from, to) => {
    if (!injected && to === path.join(w.root, 'a')) {
      injected = true;
      throw new Error('injected disk failure');
    }
    return rename(from, to);
  };
  try { assert.throws(() => new Store(w.root).move('undo'), /rolled back/); }
  finally { fs.renameSync = rename; }
  assert.equal(injected, true);
  assert.equal(w.read('a'), 'current');
  assert.equal(w.read('new'), 'valuable');
  assert.equal(JSON.parse(fs.readFileSync(path.join(w.root, '.turnback/index.json'))).pending, null);
  w.run('undo');
  assert.equal(w.read('a'), 'before');
});

test('an interrupted restore requires explicit recovery and preserves files edited after the interruption', t => {
  const w = workspace(t);
  w.write('a', 'before');
  w.run('checkpoint');
  w.write('a', 'current');
  w.run('checkpoint');
  const file = path.join(w.root, '.turnback/index.json');
  const state = JSON.parse(fs.readFileSync(file));
  state.pending = { safety: 2, target: 1 };
  fs.writeFileSync(file, JSON.stringify(state));
  w.write('a', 'partial plus new work');
  const blocked = spawnSync(process.execPath, [cli, 'undo'], { cwd: w.root, encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Interrupted restore/);
  w.run('restore', '2');
  assert.equal(w.read('a'), 'current');
  w.run('undo');
  assert.equal(w.read('a'), 'partial plus new work');
});

test('checkpoint retention prunes old manifests and unreachable objects', t => {
  const w = workspace(t);
  const store = new Store(w.root, true);
  for (let i = 0; i < 205; i++) {
    w.write('a', String(i));
    store.checkpoint('turn');
  }
  const state = store.list();
  assert.equal(state.snapshots.length, 200);
  assert.equal(state.present, 205);
  assert.equal(fs.readdirSync(path.join(w.root, '.turnback/objects')).length, 200);
  assert.equal(fs.existsSync(path.join(w.root, '.turnback/snapshots/1.json')), false);
});

test('terminal input captures before forwarding Enter and ignores newlines within bracketed paste', () => {
  const events = [];
  const gate = new InputGate(() => events.push('snapshot'), chunk => events.push(chunk.toString()));
  gate.write(Buffer.from('prompt\r'));
  assert.deepEqual(events.slice(-2), ['snapshot', '\r']);
  events.length = 0;
  for (const byte of Buffer.from('\x1b[200~multi\nline\x1b[201~\r')) gate.write(Buffer.from([byte]));
  assert.equal(events.filter(event => event === 'snapshot').length, 1);
  assert.deepEqual(events.slice(-2), ['snapshot', '\r']);
});

test('a checkpoint failure stops terminal submission', () => {
  const forwarded = [];
  const gate = new InputGate(() => { throw new Error('disk full'); }, chunk => forwarded.push(chunk.toString()));
  assert.throws(() => gate.write(Buffer.from('prompt\r')), /disk full/);
  assert.equal(forwarded.join(''), 'prompt');
});

test('Escape and UTF-8 are forwarded immediately and byte-for-byte', () => {
  const forwarded = [];
  const gate = new InputGate(() => {}, chunk => forwarded.push(chunk));
  gate.write(Buffer.from('\x1b'));
  assert.deepEqual(Buffer.concat(forwarded), Buffer.from('\x1b'));
  const unicode = Buffer.from('héllo 世界');
  for (const byte of unicode) gate.write(Buffer.from([byte]));
  assert.deepEqual(Buffer.concat(forwarded), Buffer.concat([Buffer.from('\x1b'), unicode]));
});

test('Codex completion adapter uses payload cwd and does not persist prompt text', t => {
  const w = workspace(t);
  w.write('a', 'before');
  w.run('checkpoint');
  w.write('a', 'after');
  const payload = JSON.stringify({ type: 'agent-turn-complete', cwd: w.root, 'input-messages': ['private prompt example'] });
  w.run('notify', payload);
  w.run('undo');
  assert.equal(w.read('a'), 'before');
  const index = fs.readFileSync(path.join(w.root, '.turnback/index.json'), 'utf8');
  assert.equal(index.includes('private prompt example'), false);
});

test('nested invocations use the existing project and active watches prevent restore', t => {
  const w = workspace(t);
  w.write('src/a', 'before');
  w.run('checkpoint');
  w.write('src/a', 'after');
  fs.writeFileSync(path.join(w.root, '.turnback/watch.json'), JSON.stringify({ pid: process.pid }));
  const blocked = spawnSync(process.execPath, [cli, 'undo'], { cwd: path.join(w.root, 'src'), encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Stop the watched agent/);
  assert.equal(w.read('src/a'), 'after');
  fs.unlinkSync(path.join(w.root, '.turnback/watch.json'));
  const result = spawnSync(process.execPath, [cli, 'undo'], { cwd: path.join(w.root, 'src'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(w.read('src/a'), 'before');
});

test('SIGTERM reaches a watched process and leaves its edits undoable', async t => {
  const w = workspace(t);
  w.write('a', 'before');
  const child = spawn(process.execPath, [cli, 'watch', '--', process.execPath, '-e', "require('fs').writeFileSync('a','after');console.log('CHILD_READY');setInterval(()=>{},1000)"], { cwd: w.root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Signal forwarding timed out.')); }, 10000);
    let output = '';
    child.stdout.on('data', data => {
      output += data;
      if (output.includes('CHILD_READY')) child.kill('SIGTERM');
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal }); });
  });
  assert.equal(result.code, 143);
  assert.equal(fs.existsSync(path.join(w.root, '.turnback/watch.json')), false);
  w.run('undo');
  assert.equal(w.read('a'), 'before');
});
