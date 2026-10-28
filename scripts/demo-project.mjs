import fs from 'node:fs';
import assert from 'node:assert/strict';

const mode = process.argv[2];
if (mode === 'setup') {
  fs.writeFileSync('.gitignore', '.env\n.turnback/\n');
  fs.writeFileSync('app.txt', 'app works\n');
  fs.writeFileSync('.env', 'MODE=development\n');
  fs.writeFileSync('notes.txt', 'do not lose this\n');
  fs.writeFileSync('demo-agent.mjs', `import fs from 'node:fs';
fs.writeFileSync('app.txt', 'app is broken\\n');
fs.writeFileSync('.env', 'MODE=broken\\n');
fs.unlinkSync('notes.txt');
fs.writeFileSync('junk.txt', 'unwanted\\n');
console.log('agent: overwrote app.txt and .env');
console.log('agent: deleted notes.txt, created junk.txt');
`);
} else {
  assert.ok(['broken', 'restored'].includes(mode));
  const restored = mode === 'restored';
  assert.equal(fs.readFileSync('app.txt', 'utf8'), restored ? 'app works\n' : 'app is broken\n');
  assert.equal(fs.readFileSync('.env', 'utf8'), restored ? 'MODE=development\n' : 'MODE=broken\n');
  assert.equal(fs.existsSync('notes.txt'), restored);
  assert.equal(fs.existsSync('junk.txt'), !restored);
  if (restored) assert.equal(fs.readFileSync('notes.txt', 'utf8'), 'do not lose this\n');
  else assert.equal(fs.readFileSync('junk.txt', 'utf8'), 'unwanted\n');
  process.stdout.write(`demo ${mode}: PASS\n`);
}
