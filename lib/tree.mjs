import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_FILE = 10 * 1024 * 1024;
const MAX_TREE = 250 * 1024 * 1024;
const excludedNames = new Set(['.git', '.turnback', '.turnbackignore', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', '.next', '.nuxt', '.turbo', 'target', 'dist', 'build', 'coverage']);
const reserved = name => ['.git', '.turnback'].includes(name.toLowerCase());
export const hash = data => createHash('sha256').update(data).digest('hex');
export const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const display = value => JSON.stringify(value);

export function stat(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function atomicWrite(file, data, mode = 0o600, sync = true) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', mode);
    try {
      fs.writeFileSync(fd, data);
      if (sync) fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export function exclusions(root) {
  const file = path.join(root, '.turnbackignore');
  const info = stat(file);
  if (info && !info.isFile()) throw new Error('.turnbackignore must be a regular file.');
  const patterns = info ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')) : [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!') || pattern.includes('..') || /[*?\[\]\\]/.test(pattern)) {
      throw new Error('.turnbackignore accepts literal paths or basenames, one per line; no globs or negation.');
    }
  }
  const normalized = patterns.map(value => value.replace(/^\//, '').replace(/\/$/, ''));
  return relative => {
    const parts = relative.split('/');
    if (parts.some(part => excludedNames.has(part) || reserved(part))) return true;
    return normalized.some(pattern => pattern.includes('/')
      ? relative === pattern || relative.startsWith(`${pattern}/`)
      : parts.includes(pattern));
  };
}

export function scan(root, putObject = () => {}) {
  const ignored = exclusions(root);
  const tree = [];
  const skipped = [];
  let total = 0;
  function walk(directory, prefix) {
    for (const name of fs.readdirSync(directory).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const file = path.join(directory, name);
      if (ignored(relative)) {
        skipped.push(relative);
        continue;
      }
      const before = fs.lstatSync(file);
      if (before.isSymbolicLink()) {
        tree.push({ path: relative, type: 'link', link: fs.readlinkSync(file) });
      } else if (before.isDirectory()) {
        tree.push({ path: relative, type: 'directory', mode: before.mode & 0o777 });
        walk(file, relative);
      } else if (before.isFile() && before.size <= MAX_FILE) {
        total += before.size;
        if (total > MAX_TREE) throw new Error('Snapshot exceeds 250 MiB. Exclude generated files in .turnbackignore.');
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        let data;
        try {
          const opened = fs.fstatSync(fd);
          if (opened.ino !== before.ino || opened.size > MAX_FILE) throw new Error(`File changed during checkpoint: ${display(relative)}`);
          data = fs.readFileSync(fd);
          const after = fs.fstatSync(fd);
          if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
            throw new Error(`File changed during checkpoint: ${display(relative)}. Stop writers and retry.`);
          }
        } finally { fs.closeSync(fd); }
        const object = hash(data);
        putObject(object, data);
        tree.push({ path: relative, type: 'file', mode: before.mode & 0o777, object });
      } else {
        skipped.push(relative);
      }
    }
  }
  walk(root, '');
  return { tree, skipped };
}

export function validateTree(tree) {
  if (!Array.isArray(tree)) throw new Error('Invalid snapshot tree.');
  const seen = new Map();
  for (const entry of tree) {
    const name = entry.path;
    if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.split('/').some(part => !part || part === '.' || part === '..' || excludedNames.has(part) || reserved(part))) {
      throw new Error('Unsafe path in snapshot.');
    }
    if (seen.has(name) || !['file', 'directory', 'link'].includes(entry.type)) throw new Error('Invalid snapshot entry.');
    const parent = path.posix.dirname(name);
    if (parent !== '.' && seen.get(parent) !== 'directory') throw new Error('Invalid snapshot parent.');
    if (entry.type === 'file' && !/^[a-f0-9]{64}$/.test(entry.object)) throw new Error('Invalid object ID.');
    if (entry.type === 'link' && (typeof entry.link !== 'string' || entry.link.includes('\0'))) throw new Error('Invalid symlink.');
    if (entry.type !== 'link' && (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777)) throw new Error('Invalid file mode.');
    seen.set(name, entry.type);
  }
}

export function preflight(root, target, current, skipped) {
  validateTree(target);
  const ignored = exclusions(root);
  const destinations = new Map(target.map(entry => [entry.path, entry]));
  for (const entry of target) {
    if (ignored(entry.path) || skipped.some(name => entry.path === name || entry.path.startsWith(`${name}/`))) {
      throw new Error(`Restore would overwrite an excluded path: ${display(entry.path)}. Check .turnbackignore and the 10 MiB limit.`);
    }
  }
  for (const entry of current) {
    const replacement = destinations.get(entry.path);
    if (entry.type === 'directory' && replacement?.type !== 'directory' && skipped.some(name => name.startsWith(`${entry.path}/`))) {
      throw new Error(`Restore would remove excluded files under ${display(entry.path)}.`);
    }
  }
}

export function applyTree(root, target, current, getObject) {
  const destinations = new Map(target.map(entry => [entry.path, entry]));
  const sources = new Map(current.map(entry => [entry.path, entry]));
  for (const entry of [...current].reverse()) {
    const replacement = destinations.get(entry.path);
    if (replacement?.type === entry.type) continue;
    const file = path.join(root, entry.path);
    if (entry.type === 'directory') {
      try { fs.rmdirSync(file); } catch (error) {
        if (!['ENOTEMPTY', 'EEXIST'].includes(error.code) || replacement) throw error;
      }
    } else { fs.unlinkSync(file); }
  }
  for (const entry of target) {
    if (sameTree(entry, sources.get(entry.path))) continue;
    const file = path.join(root, entry.path);
    if (entry.type === 'directory') {
      if (!stat(file)) fs.mkdirSync(file, { recursive: false, mode: 0o700 });
    } else if (entry.type === 'file') {
      atomicWrite(file, getObject(entry.object), entry.mode);
      fs.chmodSync(file, entry.mode);
    } else {
      if (stat(file)) fs.unlinkSync(file);
      fs.symlinkSync(entry.link, file);
    }
  }
  for (const entry of [...target].reverse()) {
    if (entry.type === 'directory' && !sameTree(entry, sources.get(entry.path))) fs.chmodSync(path.join(root, entry.path), entry.mode);
  }
}
