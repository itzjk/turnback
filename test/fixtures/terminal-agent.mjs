import fs from 'node:fs';

if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(99);
if (process.argv[2] !== "quote' and $(touch injected)") process.exit(98);
process.stdin.setRawMode(true);
process.stdout.write('AGENT_READY\r\n');
process.stdout.on('resize', () => process.stdout.write(`AGENT_RESIZED_${process.stdout.columns}x${process.stdout.rows}\r\n`));
let prompt = '';
let turn = 0;
process.stdin.on('data', chunk => {
  for (const character of chunk.toString()) {
    if (character === '\r') {
      if (prompt === 'quit') process.exit(7);
      turn++;
      fs.writeFileSync('app.txt', `turn ${turn}\n`);
      fs.writeFileSync('.env', `VALUE=${turn}\n`);
      process.stdout.write(`AGENT_DONE_${turn}\r\n`);
      prompt = '';
    } else {
      prompt += character;
    }
  }
});
