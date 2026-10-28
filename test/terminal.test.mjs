import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = process.env.TURNBACK_CLI || fileURLToPath(new URL('../bin/turnback.mjs', import.meta.url));
const agent = fileURLToPath(new URL('./fixtures/terminal-agent.mjs', import.meta.url));
const python = spawnSync('python3', ['--version']).status === 0;

test('interactive watch keeps a real TTY and checkpoints between two terminal turns', { skip: !python || !['darwin', 'linux'].includes(process.platform) }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'turnback-pty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'app.txt'), 'original\n');
  fs.writeFileSync(path.join(root, '.env'), 'VALUE=original\n');
  const driver = `import os, pty, select, sys, time, signal, fcntl, termios, struct
pid, terminal = pty.fork()
if pid == 0:
    os.chdir(sys.argv[1])
    os.execv(sys.argv[2], [sys.argv[2], sys.argv[3], 'watch', '--', sys.argv[2], sys.argv[4], "quote' and $(touch injected)"])
log = b''
def expect(marker):
    global log
    deadline = time.monotonic() + 10
    while marker not in log:
        if time.monotonic() > deadline:
            raise RuntimeError('PTY timeout: ' + repr(log[-2000:]))
        ready, _, _ = select.select([terminal], [], [], 0.2)
        if ready:
            data = os.read(terminal, 65536)
            if not data:
                raise RuntimeError('PTY closed: ' + repr(log[-2000:]))
            log += data
try:
    expect(b'AGENT_READY')
    fcntl.ioctl(terminal, termios.TIOCSWINSZ, struct.pack('HHHH', 33, 101, 0, 0))
    expect(b'AGENT_RESIZED_101x33')
    os.write(terminal, b'first prompt\\r')
    expect(b'AGENT_DONE_1')
    os.write(terminal, b'second prompt\\r')
    expect(b'AGENT_DONE_2')
    os.write(terminal, b'quit\\r')
    deadline = time.monotonic() + 10
    while True:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            code = os.waitstatus_to_exitcode(status)
            print('agent exit:', code)
            sys.exit(0 if code == 7 else 1)
        if time.monotonic() > deadline:
            raise RuntimeError('wrapper did not exit')
        select.select([], [], [], 0.05)
finally:
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    os.close(terminal)
`;
  const session = spawnSync('python3', ['-c', driver, root, process.execPath, cli, agent], { encoding: 'utf8', timeout: 25000 });
  assert.equal(session.status, 0, session.stderr || session.error?.message || session.stdout);
  assert.equal(fs.existsSync(path.join(root, 'injected')), false);
  const run = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
  };
  run('undo');
  assert.equal(fs.readFileSync(path.join(root, 'app.txt'), 'utf8'), 'turn 1\n');
  assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'VALUE=1\n');
  run('undo');
  assert.equal(fs.readFileSync(path.join(root, 'app.txt'), 'utf8'), 'original\n');
  run('redo');
  assert.equal(fs.readFileSync(path.join(root, 'app.txt'), 'utf8'), 'turn 1\n');
});
