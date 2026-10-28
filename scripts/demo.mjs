import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/turnback.mjs', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turnback-demo-'));
const transcript = [];
function run(label, command, args) {
  transcript.push(`$ ${label}`);
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 15000 });
  if (result.stderr) transcript.push(result.stderr.trimEnd());
  if (result.stdout) transcript.push(result.stdout.trimEnd());
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}
try {
  fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');
  fs.writeFileSync(path.join(root, 'app.txt'), 'app works\n');
  fs.writeFileSync(path.join(root, '.env'), 'MODE=development\n');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'do not lose this\n');
  fs.writeFileSync(path.join(root, 'demo-agent.mjs'), `import fs from 'node:fs';
fs.writeFileSync('app.txt', 'app is broken\\n');
fs.writeFileSync('.env', 'MODE=broken\\n');
fs.unlinkSync('notes.txt');
fs.writeFileSync('junk.txt', 'unwanted\\n');
console.log('agent: broke app.txt and .env, deleted notes.txt, created junk.txt');
`);
  run('turnback watch -- node demo-agent.mjs', process.execPath, [cli, 'watch', '--', process.execPath, 'demo-agent.mjs']);
  run('turnback undo', process.execPath, [cli, 'undo']);
  run('cat app.txt .env notes.txt', 'cat', ['app.txt', '.env', 'notes.txt']);
  assert.equal(fs.existsSync(path.join(root, 'junk.txt')), false);
  run('turnback redo', process.execPath, [cli, 'redo']);
  assert.equal(fs.readFileSync(path.join(root, 'app.txt'), 'utf8'), 'app is broken\n');
  assert.equal(fs.existsSync(path.join(root, 'notes.txt')), false);
  const text = `${transcript.join('\n')}\n`;
  process.stdout.write(text);
  if (process.argv.includes('--save')) {
    const destination = fileURLToPath(new URL('../docs/demo.txt', import.meta.url));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
