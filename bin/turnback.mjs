#!/usr/bin/env node
import { Store, projectRoot } from '../lib/store.mjs';
import { display } from '../lib/tree.mjs';
import { watch } from '../lib/watch.mjs';
import { formatDiff } from '../lib/diff.mjs';

const help = `turnback, Ctrl+Z for AI coding agents

Usage:
  turnback watch -- <agent> [args]   Checkpoint before launch and terminal submits
  turnback checkpoint [label]       Save the current tree (also usable as a hook)
  turnback undo                    Undo the last checkpointed change
  turnback redo                    Reapply an undo
  turnback list                    Show checkpoint IDs, newest first
  turnback diff [id]               List paths changed since a checkpoint
  turnback restore <id>            Restore a checkpoint, saving current work first
  turnback notify <json>           Codex turn-complete notification adapter

Options before the command:
  --cwd <directory>                Use this project directory
  --quiet                          Suppress successful checkpoint output
  --help                           Show this help
  --version                        Print version

Git-ignored files, including .env, are included. .git is always excluded.
Stop writers before restoring. See README for limits and exclusions.
`;

function checkpointId(text) {
  if (!/^[1-9]\d*$/.test(text ?? '') || !Number.isSafeInteger(Number(text))) throw new Error('Checkpoint ID must be a positive integer from turnback list.');
  return Number(text);
}

try {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let quiet = false;
  while (args[0]?.startsWith('--') && !['--help', '--version'].includes(args[0])) {
    const option = args.shift();
    if (option === '--cwd') {
      cwd = args.shift();
      if (!cwd) throw new Error('--cwd requires a directory.');
    } else if (option === '--quiet') quiet = true;
    else throw new Error(`Unknown option: ${display(option)}`);
  }
  const command = args.shift() ?? '--help';
  if (command === '--help' || command === 'help') process.stdout.write(help);
  else if (command === '--version') process.stdout.write('0.1.0\n');
  else {
    if (!['watch', 'checkpoint', 'undo', 'redo', 'list', 'diff', 'restore', 'notify'].includes(command)) throw new Error(`Unknown command: ${display(command)}. Run turnback --help.`);
    let notification;
    if (command === 'notify') {
      if (args.length !== 1) throw new Error('notify expects the single JSON argument supplied by Codex.');
      notification = JSON.parse(args[0]);
      if (notification.type !== 'agent-turn-complete') process.exit(0);
      if (typeof notification.cwd !== 'string' || !notification.cwd) throw new Error('Codex notification is missing cwd.');
      cwd = notification.cwd;
    }
    if (['undo', 'redo', 'list'].includes(command) && args.length) throw new Error(`${command} does not accept arguments.`);
    if ((command === 'restore' && args.length !== 1) || (command === 'diff' && args.length > 1)) throw new Error(`Usage: turnback ${command} ${command === 'restore' ? '<id>' : '[id]'}`);
    if (command === 'watch' && args.shift() !== '--') throw new Error('Usage: turnback watch -- <agent> [arguments]');
    const store = new Store(projectRoot(cwd), ['watch', 'checkpoint'].includes(command));
    if (command === 'notify') store.checkpoint('after Codex turn');
    else if (command === 'watch') process.exitCode = await watch(store, args);
    else if (command === 'checkpoint') {
      const result = store.checkpoint(args.join(' ') || 'checkpoint');
      if (!quiet) {
        process.stdout.write(`Checkpoint #${result.id}${result.created ? ' saved' : ' unchanged'}.\n`);
        const skipped = result.skipped.filter(name => name !== '.turnback');
        if (skipped.length) process.stdout.write(`Excluded: ${skipped.map(display).join(', ')}\n`);
      }
    } else if (command === 'list') {
      const state = store.list();
      for (const snapshot of state.snapshots) process.stdout.write(`${snapshot.id === state.present ? '*' : ' '} #${snapshot.id}  ${snapshot.time}  ${display(snapshot.label)}\n`);
      if (!state.snapshots.length) process.stdout.write('No checkpoints.\n');
    } else if (command === 'diff') {
      const changes = store.diff(args.length ? checkpointId(args[0]) : undefined);
      process.stdout.write(formatDiff(changes));
    } else {
      const result = store.move(command, command === 'restore' ? checkpointId(args[0]) : undefined);
      process.stdout.write(`Restored #${result.target}. Previous files saved as #${result.safety}.\n`);
      process.stdout.write(command === 'undo' ? 'Run turnback redo to reapply.\n' : 'Run turnback undo to go back.\n');
    }
  }
} catch (error) {
  process.stderr.write(`turnback: ${error.message}\n`);
  process.exitCode = 1;
}
