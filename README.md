# turnback

Ctrl+Z for AI coding agents.

[![CI](https://github.com/itzjk/turnback/actions/workflows/ci.yml/badge.svg)](https://github.com/itzjk/turnback/actions/workflows/ci.yml)
[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```console
$ turnback watch -- node demo-agent.mjs
turnback: checkpoint #1. Stop the agent, then run turnback undo.
agent: broke app.txt and .env, deleted notes.txt, created junk.txt
$ turnback undo
Restored #1. Previous files saved as #2.
Run turnback redo to reapply.
$ cat app.txt .env notes.txt
app works
MODE=development
do not lose this
```

[Run the scripted demo or record it with VHS](docs/guide.md#recording-the-demo).

## Quick start

Install with Node.js 22+ on macOS or Linux:

```sh
npm install --global --install-links github:itzjk/turnback
```

Inside the project you want to protect, wrap your terminal agent:

```sh
turnback watch -- codex
```

Replace `codex` with `claude`, `gemini`, `opencode`, `aider`, or another terminal command. When a turn goes wrong, stop the agent and run `turnback undo`. Changed files, deleted files and git-ignored files return to their checkpoint. Run `turnback redo` to bring the saved work back.

## Features

- Recover edits, deletions and unwanted new files with one undo.
- Protect git-ignored files, including `.env`, alongside your source.
- Keep your git history, branches and staging area untouched.
- Wrap terminal agents without configuring plugins or hooks.
- Inspect changes and restore any retained checkpoint by ID.

## Why

An agent can rewrite a working project in one turn; making a commit before every prompt gets old. On October 27, 2026, [Codex's request to bring back /undo](https://github.com/openai/codex/issues/9203) was open with **490 thumbs-up reactions**. turnback gives file recovery its own history, covering files git ignores too; [research notes](docs/research.md) compare the neighboring tools.

## How it works

turnback saves a checkpoint before launching the agent and before forwarding each interactive Enter. It stores file contents in a separate `.turnback/` directory, sharing identical contents between checkpoints without invoking git. Before restoring, it saves your current files so you can undo the restore too. Node.js keeps installation to one npm command, with a prebuilt PTY dependency for terminal support. [Storage and recovery details](docs/guide.md#how-it-works).

## Usage

| Command | What it does |
| --- | --- |
| `turnback watch -- <command> [args]` | Checkpoint before launch and terminal submissions |
| `turnback checkpoint [label]` | Save manually or from an agent hook |
| `turnback undo` | Save current work and go back |
| `turnback redo` | Reapply an undo |
| `turnback list` | Show checkpoint IDs, labels and times |
| `turnback diff [id]` | Compare your files with a checkpoint |
| `turnback restore <id>` | Restore a checkpoint, saving current work first |

Options go before the command, for example `turnback --cwd ./project undo`. On first use, the current directory becomes the project boundary. Later invocations find an existing store in parent directories. [Navigation rules and options](docs/guide.md#commands-and-navigation).

## FAQ

**Does it work with my agent?** Terminal wrapping is independent of the agent. Live authenticated sessions with every named agent have not been tested. Optional [Claude Code and Codex integrations](docs/guide.md#optional-integrations) offer agent events instead of terminal submissions.

**Does it touch my git repository?** No. turnback never reads or writes `.git`, and works outside git repositories. Add `.turnback/` to your `.gitignore` to keep local checkpoints out of commits.

**What happens to secrets and dependencies?** `.env` is included. Dependencies, build output and files over 10 MiB are excluded. Add literal paths or basenames to `.turnbackignore` for [extra exclusions](docs/guide.md#what-gets-saved). The store contains plaintext copies of secrets; keep it local. Diff output can contain them too.

**Can I undo an undo?** Yes, with `turnback redo`. New edits after an undo block redo until you checkpoint or undo those edits. Numbered restores are also undoable.

## Limitations

- Enter is a submission boundary. Approval prompts may add checkpoints; autonomous background turns need hooks. Piped input gets one checkpoint before launch.
- Stop agents, autosaving editors and other writers before restoring. Multi-file restores use a recovery journal, rather than a filesystem-wide atomic operation.
- History retains up to 200 checkpoints, with a 250 MiB limit per snapshot. Scanning large trees adds latency; exclude generated output.
- Recovery covers files inside the project. External services, git operations and agent conversation memory cannot be rewound. [Full limits](docs/guide.md#limits).

## Contributing

From a clone, run `npm ci` then `npm test`; include a reproducer with bug reports. [Development and demo recording](docs/guide.md#recording-the-demo).

## License

[MIT](LICENSE).
