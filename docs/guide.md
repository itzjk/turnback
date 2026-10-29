# User guide

[Back to the quick start](../README.md).

## What counts as a turn?

In an interactive terminal, `watch` checkpoints before forwarding each Enter to the agent. It keeps the agent on a real pseudoterminal, forwards signals and window resizing, and understands bracketed paste. Unchanged trees share a checkpoint.

Enter is a terminal submission, not a universal agent event. Approval prompts and unbracketed multiline pastes can add checkpoints. Autonomous background turns and agents that submit with another key are not detected. A command with piped input gets one checkpoint before launch. Use the optional hooks below when you need exact agent boundaries.

## Commands and navigation

| Command | Result |
| --- | --- |
| `turnback watch -- <command> [args]` | Save before launch and before interactive submissions |
| `turnback checkpoint [label]` | Save the current tree manually or from a hook |
| `turnback undo` | Save unsaved work, then go back one checkpoint |
| `turnback redo` | Reapply an undo |
| `turnback list` | Show stable IDs, labels and timestamps; `*` marks the current checkpoint |
| `turnback diff [id]` | Compare the live tree with a checkpoint, defaulting to the current one |
| `turnback restore <id>` | Save current work and restore any retained checkpoint |

`diff` includes full replacement hunks for small text files, file modes, symlink changes, and a summary for binary files or files above 64 KiB. It can print secrets from `.env`, so review output before sharing it.

Options go before the command: `turnback --cwd ./project undo`, `turnback --quiet checkpoint before-turn`, `turnback --help`, `turnback --version`. From a subdirectory, turnback finds the nearest parent with a `.turnback` store. On first use, the current directory becomes the project boundary.

Undo after unsaved edits restores the current checkpoint and keeps those edits for redo. Otherwise it walks backward through saved checkpoints. New edits after an undo block redo until you checkpoint or undo those edits. Restoring a numbered checkpoint is also undoable. Older branches remain accessible by ID until retention expires.

Saving a checkpoint preserves pending redo steps. For example, after undoing an agent turn, save any manual edits with `turnback checkpoint manual`, then run `turnback redo` to recover the agent's version. Running `turnback undo` brings the manual edits back. Multiple pending redo steps keep their order. Numbered `restore` starts a new navigation path and clears pending redo steps; retained checkpoints remain accessible by ID.

## Optional integrations

### Claude Code: before each prompt

Merge this into your project's `.claude/settings.local.json`, preserving existing hooks:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "turnback --cwd \"$CLAUDE_PROJECT_DIR\" --quiet checkpoint before-turn || exit 2",
            "onFailure": "block"
          }
        ]
      }
    ]
  }
}
```

Run `claude` normally with this hook, without `watch`. The synchronous hook captures before the prompt; exit code 2 blocks submission when checkpointing fails. The store is created on the first prompt. See the [official hook reference](https://code.claude.com/docs/en/hooks#userpromptsubmit).

### Codex: after each completed turn

Run `turnback checkpoint baseline` before starting Codex. Add this to your user-level `~/.codex/config.toml`:

```toml
notify = ["turnback", "notify"]
```

This adapter reads Codex's JSON argument, uses its `cwd`, and saves a checkpoint after `agent-turn-complete`. It discards prompt and response text. A baseline plus completion checkpoints lets `undo` step back through completed turns. `notify` is an after-turn event, so it does not protect a failed or interrupted first turn without that baseline. Existing notification commands must be combined manually; don't overwrite one you need. See [official notification documentation](https://developers.openai.com/codex/config-advanced#notifications).

The adapters are tested with representative payloads. Live authenticated sessions with each named agent have not been validated. For other hook systems, call `turnback --quiet checkpoint before-turn` synchronously before the agent edits files.

## What gets saved?

Files ignored by **git** are saved, including `.env`. turnback does not read `.gitignore` or invoke git.

Always excluded at any depth: `.git`, `.turnback`, `.turnbackignore`, `node_modules`, `.venv`, `venv`, `__pycache__`, `.cache`, `.next`, `.nuxt`, `.turbo`, `target`, `dist`, `build`, and `coverage`. `.git` and `.turnback` are protected regardless of case. Files above **10 MiB**, sockets, devices and FIFOs are excluded. Smaller binaries are saved. Checkpoints report exclusions; `watch` prints their count.

Add a `.turnbackignore` file for extra exclusions, one literal path or basename per line:

```text
artifacts
data/cache
local-secrets.txt
```

A basename matches at any depth. A path containing `/` is relative to the project root. Blank lines and lines starting with `#` are ignored. Globs, negation, backslashes and `..` are rejected. Excluded paths are never restored or deleted. The current `.turnbackignore` is always retained, so recovery cannot remove the rules protecting those paths. If restoring would overwrite an excluded path or replace its containing directory, turnback refuses before applying changes. Changing exclusion rules between checkpoints can require adjusting the rules before a restore succeeds.

Symlinks are stored as links and never traversed. File permissions and empty directories are preserved. Timestamps, ownership, ACLs, extended attributes and hard-link relationships are not preserved.

## How it works

`.turnback/` is a private shadow store: SHA-256 content objects, manifests, and an atomically replaced index. Identical contents are stored once. No git repository is required. Your real `.git`, index, branches and commits are never read or written by turnback. Git operations performed by the agent itself are outside this guarantee.

Before a restore, turnback validates paths and content hashes, checks exclusions, and saves the current tree as a safety checkpoint. It then records a recovery journal, restores with atomic per-file replacements, verifies the tree, and only then advances navigation. A write failure triggers rollback. If rollback cannot finish or the process crashes, further navigation stops with the exact recovery command. Explicit recovery saves the interrupted tree first.

Keep `.turnback/` out of commits by adding `.turnback/` to your project's `.gitignore` yourself. turnback never edits that file for you. The store contains local plaintext copies of secrets, with private directory permissions; it is not encrypted. Never upload it.

History is rolling: at most **200 checkpoints**, with the active checkpoint and in-progress recovery checkpoints protected. Old manifests and unreferenced content are pruned as new checkpoints are saved. A snapshot is limited to **250 MiB** of included file contents; exceeding that limit fails checkpointing. Allow space for retained changes and a safety snapshot before restoring.

## Limits

- macOS and Linux only for this release. Node.js 22+; PTY prebuilds target x64 and arm64. Other platforms and architectures are unverified.
- Stop all agents, editors with autosave, dev servers and background writers before restoring. turnback blocks restores while its own watched process is active; it cannot lock other applications out of your files. Concurrent checkpoints fail fast on the store lock.
- Snapshots scan and hash the included tree. Large source trees increase prompt latency; exclude generated output. This is not a continuous backup or a filesystem-wide atomic snapshot.
- Multi-file restore is not atomic. The saved safety checkpoint and journal provide recovery. Content objects are written and renamed before the index; manifests, the index and restored files are fsynced, while content objects are not individually fsynced. Power-loss durability, network filesystems and hostile same-user processes have not been validated. An agent with filesystem access can delete `.turnback` too.
- Only files inside the project boundary are recoverable. Sent emails, deployments, external databases, git changes and files outside that boundary cannot be undone. Agent conversation memory is not rewound; tell the agent you restored files before continuing.
- Retention expires old checkpoints. Excluded files have no recovery guarantee. Keep an independent backup for irreplaceable work.

## Development and verification

```sh
npm ci
npm test
npm run demo
npm pack --dry-run
```

The tests exercise undo/redo, ignored secrets, deletion recovery, full `.git` byte invariance, real PTY turns, binary files, permissions, symlink boundaries, exclusions, corruption, injected disk failures, crash recovery and retention. Python 3 is used only by the PTY test driver; that test is explicitly skipped if Python is missing. CI runs the suite on macOS and Ubuntu with Node 22 and 24.

To try a local build after `npm ci`, run `npm install --global --install-links .`. The GitHub installation command in the README works without a clone.

## Recording the demo

From a clone with dependencies installed, run `vhs docs/demo.tape`. VHS, ffmpeg and ttyd are recording tools; they are not runtime dependencies of turnback.

The tape records real CLI commands in a temporary project. `scripts/demo-setup.sh` creates that project with a git-ignored `.env`, an app file, and notes. Its `demo-agent.mjs` is a deterministic fixture that edits the app and `.env`, deletes the notes, and creates an unwanted file. No AI service is called. The terminal shows the broken files, undo, restored files, and redo. Hidden assertions verify file contents and deletion recovery, then remove the temporary project.

The setup puts the local CLI on PATH, so the recording works without a global install and records the current source. Run the tape from the repository root; it writes `docs/demo.gif`. The nonvisual equivalent is `npm run demo`.
