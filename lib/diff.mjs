import { display } from './tree.mjs';

export function formatDiff(changes) {
  const output = [];
  for (const change of changes) {
    output.push(`${change.kind} ${display(change.path)}`);
    if (change.before?.type === 'link' || change.after?.type === 'link') {
      output.push(`  symlink: ${display(change.before?.link ?? null)} -> ${display(change.after?.link ?? null)}`);
    }
    if (change.before?.mode !== change.after?.mode) {
      output.push(`  mode: ${change.before?.mode?.toString(8) ?? '-'} -> ${change.after?.mode?.toString(8) ?? '-'}`);
    }
    const oldData = change.oldData ?? Buffer.alloc(0);
    const newData = change.newData ?? Buffer.alloc(0);
    if (oldData.equals(newData)) continue;
    if ([oldData, newData].some(data => data.length > 64 * 1024 || data.includes(0) || !Buffer.from(data.toString('utf8')).equals(data))) {
      output.push('  Binary or large file contents differ.');
      continue;
    }
    const lines = data => data.length ? data.toString('utf8').replace(/\n$/, '').split('\n') : [];
    const before = lines(oldData);
    const after = lines(newData);
    output.push(`--- ${change.before ? display(`a/${change.path}`) : '/dev/null'}`);
    output.push(`+++ ${change.after ? display(`b/${change.path}`) : '/dev/null'}`);
    output.push(`@@ -${before.length ? 1 : 0},${before.length} +${after.length ? 1 : 0},${after.length} @@`);
    for (const line of before) output.push(`-${line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)}`);
    if (oldData.length && oldData.at(-1) !== 10) output.push('\\ No newline at end of file');
    for (const line of after) output.push(`+${line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)}`);
    if (newData.length && newData.at(-1) !== 10) output.push('\\ No newline at end of file');
  }
  return output.length ? `${output.join('\n')}\n` : 'No changes.\n';
}
