import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { atomicWrite, stat, scan, hash, sameTree, validateTree, preflight, applyTree } from './tree.mjs';

const LIMIT = 200;
export function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function projectRoot(start) {
  let candidate = fs.realpathSync(start);
  for (;;) {
    if (stat(path.join(candidate, '.turnback'))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return fs.realpathSync(start);
    candidate = parent;
  }
}

export class Store {
  constructor(root, create = false) {
    this.root = fs.realpathSync(root);
    if (this.root === path.parse(this.root).root || this.root === os.homedir()) throw new Error('Choose a project directory, not your home or filesystem root.');
    this.directory = path.join(this.root, '.turnback');
    if (!stat(this.directory) && !create) throw new Error('No checkpoints here. Run turnback watch -- <agent> or turnback checkpoint first.');
    if (!stat(this.directory)) fs.mkdirSync(this.directory, { mode: 0o700 });
    if (!stat(this.directory).isDirectory() || stat(this.directory).isSymbolicLink()) throw new Error('.turnback must be a real directory, never a symlink.');
    for (const name of ['objects', 'snapshots']) {
      const file = path.join(this.directory, name);
      if (!stat(file)) fs.mkdirSync(file, { mode: 0o700 });
      if (!stat(file).isDirectory() || stat(file).isSymbolicLink()) throw new Error(`Unsafe storage directory: ${name}`);
    }
    for (const name of fs.readdirSync(this.directory)) {
      if (stat(path.join(this.directory, name)).isSymbolicLink()) throw new Error('Symlinks inside .turnback are not allowed.');
    }
  }

  transact(operation, { recover = false } = {}) {
    const lock = path.join(this.directory, 'lock');
    const owner = stat(lock);
    if (owner) {
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (!pid || alive(pid)) throw new Error('Another turnback operation is running. Retry when it finishes.');
      fs.unlinkSync(lock);
    }
    const fd = fs.openSync(lock, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, String(process.pid));
      const file = path.join(this.directory, 'index.json');
      this.state = stat(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, nextId: 1, snapshots: [], past: [], present: null, future: [], pending: null };
      if (this.state.version !== 1 || !Array.isArray(this.state.snapshots)) throw new Error('Unsupported or damaged checkpoint index.');
      if (this.state.pending && !recover) throw new Error(`Interrupted restore. Run turnback restore ${this.state.pending.safety} to recover. Current files will be saved first.`);
      return operation();
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }

  readTree(id) {
    if (!Number.isSafeInteger(id) || !this.state.snapshots.some(snapshot => snapshot.id === id)) throw new Error(`Checkpoint #${id} does not exist.`);
    const file = path.join(this.directory, 'snapshots', `${id}.json`);
    if (!stat(file)?.isFile() || stat(file).isSymbolicLink()) throw new Error('Unsafe or missing snapshot file.');
    const tree = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateTree(tree);
    return tree;
  }

  getObject(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid object ID.');
    const file = path.join(this.directory, 'objects', id);
    if (!stat(file)?.isFile() || stat(file).isSymbolicLink()) throw new Error(`Missing or unsafe object ${id}.`);
    const data = fs.readFileSync(file);
    if (hash(data) !== id) throw new Error(`Corrupt object ${id}. No restore was started.`);
    return data;
  }

  capture(label) {
    const createdObjects = [];
    let result;
    try {
      result = scan(this.root, (id, data) => {
        const file = path.join(this.directory, 'objects', id);
        if (!stat(file)) {
          atomicWrite(file, data, 0o600, false);
          createdObjects.push(file);
        } else this.getObject(id);
      });
    } catch (error) {
      for (const file of createdObjects) fs.rmSync(file, { force: true });
      throw error;
    }
    if (this.state.present && sameTree(result.tree, this.readTree(this.state.present))) return { ...result, id: this.state.present, created: false };
    const id = this.state.nextId++;
    atomicWrite(path.join(this.directory, 'snapshots', `${id}.json`), JSON.stringify(result.tree));
    this.state.snapshots.push({ id, time: new Date().toISOString(), label: label.slice(0, 160) });
    return { ...result, id, created: true };
  }

  save() {
    const protectedIds = new Set([this.state.present, this.state.pending?.safety, this.state.pending?.target].filter(Boolean));
    const newest = this.state.snapshots.filter(snapshot => !protectedIds.has(snapshot.id)).slice(-(LIMIT - protectedIds.size));
    const keep = new Set([...protectedIds, ...newest.map(snapshot => snapshot.id)]);
    this.state.snapshots = this.state.snapshots.filter(snapshot => keep.has(snapshot.id));
    this.state.past = this.state.past.filter(id => keep.has(id));
    this.state.future = this.state.future.filter(id => keep.has(id));
    atomicWrite(path.join(this.directory, 'index.json'), JSON.stringify(this.state));
    const objects = new Set();
    for (const snapshot of this.state.snapshots) {
      for (const entry of this.readTree(snapshot.id)) if (entry.object) objects.add(entry.object);
    }
    for (const name of fs.readdirSync(path.join(this.directory, 'snapshots'))) {
      if (/^\d+\.json$/.test(name) && !keep.has(Number(name.slice(0, -5)))) fs.unlinkSync(path.join(this.directory, 'snapshots', name));
    }
    for (const name of fs.readdirSync(path.join(this.directory, 'objects'))) {
      if (/^[a-f0-9]{64}$/.test(name) && !objects.has(name)) fs.unlinkSync(path.join(this.directory, 'objects', name));
    }
  }

  checkpoint(label = 'checkpoint') {
    return this.transact(() => {
      const result = this.capture(label);
      if (result.created) {
        if (this.state.present) this.state.past.push(this.state.present);
        this.state.present = result.id;
        this.save();
      }
      return result;
    });
  }

  assertStopped() {
    const file = path.join(this.directory, 'watch.json');
    if (stat(file)) {
      const watcher = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (alive(watcher.pid) || alive(watcher.child)) throw new Error('Stop the watched agent before undo, redo or restore.');
    }
  }

  move(command, id) {
    return this.transact(() => {
      this.assertStopped();
      const targetTree = command === 'restore' ? this.readTree(id) : null;
      const previous = structuredClone(this.state);
      const live = scan(this.root);
      const dirty = !this.state.present || !sameTree(live.tree, this.readTree(this.state.present));
      if (command === 'redo' && dirty) throw new Error('Files changed since undo. Save a checkpoint or undo those edits before redo.');
      let target;
      if (command === 'undo') target = dirty ? this.state.present : this.state.past.at(-1);
      if (command === 'redo') target = this.state.future[0];
      if (command === 'restore') target = id;
      if (!target) throw new Error(`Nothing to ${command}.`);
      const tree = targetTree ?? this.readTree(target);
      preflight(this.root, tree, live.tree, live.skipped);
      for (const entry of tree) if (entry.object) this.getObject(entry.object);
      const safety = this.capture('safety before restore');
      if (!sameTree(live.tree, safety.tree)) throw new Error('Files changed during restore preparation. Stop all writers and retry.');
      const navigation = { past: [...this.state.past], present: target, future: [...this.state.future] };
      if (command === 'undo') {
        if (!dirty) navigation.past.pop();
        navigation.future = dirty ? [safety.id] : [safety.id, ...navigation.future];
      } else if (command === 'redo') {
        navigation.past.push(safety.id);
        navigation.future.shift();
      } else {
        if (safety.id !== target) navigation.past.push(safety.id);
        navigation.future = [];
      }
      this.state.pending = { safety: safety.id, target };
      this.save();
      try {
        applyTree(this.root, tree, live.tree, object => this.getObject(object));
        const observed = scan(this.root).tree;
        if (!sameTree(observed, tree)) throw new Error('Restored files do not match the checkpoint.');
      } catch (error) {
        try {
          const interrupted = scan(this.root);
          preflight(this.root, safety.tree, interrupted.tree, interrupted.skipped);
          applyTree(this.root, safety.tree, interrupted.tree, object => this.getObject(object));
          if (!sameTree(scan(this.root).tree, safety.tree)) throw new Error('Rollback verification failed.');
          this.state.past = previous.past;
          this.state.present = previous.present;
          this.state.future = previous.future;
          this.state.pending = previous.pending;
          this.save();
        } catch {
          throw new Error(`Restore failed: ${error.message}. Safety checkpoint #${safety.id} is saved. Run turnback restore ${safety.id} after fixing the filesystem error.`);
        }
        throw new Error(`Restore failed and was rolled back: ${error.message}. Safety checkpoint #${safety.id} is saved.`);
      }
      Object.assign(this.state, navigation, { pending: null });
      this.save();
      return { target, safety: safety.id };
    }, { recover: command === 'restore' });
  }

  list() {
    return this.transact(() => ({ ...this.state, snapshots: [...this.state.snapshots].reverse() }));
  }

  diff(id) {
    return this.transact(() => {
      const tree = this.readTree(id ?? this.state.present);
      const live = scan(this.root).tree;
      const before = new Map(tree.map(entry => [entry.path, entry]));
      const after = new Map(live.map(entry => [entry.path, entry]));
      return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(name => {
        if (sameTree(before.get(name), after.get(name))) return [];
        const a = before.get(name);
        const b = after.get(name);
        const read = entry => entry?.type === 'file' ? this.getObject(entry.object) : null;
        return [{ path: name, kind: !a ? 'A' : !b ? 'D' : 'M', before: a, after: b, oldData: read(a), newData: b?.type === 'file' ? fs.readFileSync(path.join(this.root, name)) : null }];
      });
    });
  }
}
