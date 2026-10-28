# Evidence and neighboring tools

Checked 2026-10-27. Counts are a point-in-time measurement, not a market-size estimate.

| Primary source | Observed |
| --- | --- |
| [Codex issue #9203 API](https://api.github.com/repos/openai/codex/issues/9203) | `state: open`, `reactions["+1"]: 490` |
| [ckpt repository API](https://api.github.com/repos/mohshomis/ckpt) | `stargazers_count: 7` |
| [Sheep repository API](https://api.github.com/repos/gokay-ai/sheep) | `stargazers_count: 6` |
| [agent-undo repository API](https://api.github.com/repos/luxavr/agent-undo) | `stargazers_count: 0` |
| [snap-back repository API](https://api.github.com/repos/Abelo9996/snap-back) | `stargazers_count: 0` |

Discovery queries were `"Please make" "/undo" "codex"` and `github mohshomis ckpt gokay-ai sheep luxavr agent-undo Abelo9996 snap-back`. Counts came from direct GET requests to the five API URLs above. Source repository READMEs were then inspected directly; search snippets were not used as current counts.

These projects already solve substantial parts of the brief. Their published scope, rather than their star counts, is the useful comparison:

| Tool | Documented scope | turnback's different scope |
| --- | --- | --- |
| [ckpt](https://github.com/mohshomis/ckpt#how-it-works) | Checkpoints are commits on a hidden branch in the project repository | No git executable or git operations |
| [Sheep](https://github.com/gokay-ai/sheep) | herdr recorder and turn restoration; ignored files excluded | Standalone terminal wrapper; ignored files included |
| [snap-back](https://github.com/Abelo9996/snap-back) | Shadow git store, wrapper, watcher and Claude hooks; `.gitignore` honored | Ignored files included; Enter boundaries and dedicated redo |
| [agent-undo](https://github.com/luxavr/agent-undo) | One checkpoint per terminal session; small ignored files included; HEAD/branch recovery | Submission checkpoints; git metadata never restored |

Those descriptions are based on their READMEs, not independent execution of competing tools. turnback focuses on one workflow: checkpoint each terminal submission, recover git-ignored files by default, and navigate undo and redo without invoking git. snap-back is an alternative for users who want file watching and Claude hooks while keeping git-ignored files outside their snapshots. agent-undo covers small ignored files with session-level checkpoints. turnback's automated tests cover its submission boundaries, ignored-file recovery and redo navigation; they do not benchmark competing tools.

Integration references, also read 2026-10-27:

- [Claude UserPromptSubmit and exit-code behavior](https://code.claude.com/docs/en/hooks): synchronous pre-prompt commands, blocking exit code 2, and `onFailure` policy.
- [Codex notifications](https://developers.openai.com/codex/config-advanced#notifications): `agent-turn-complete`, a single JSON argument containing `cwd`, and completion rather than pre-turn timing. Query: `Codex CLI notify turn complete site:developers.openai.com`.
- [node-pty](https://github.com/microsoft/node-pty) and its [prebuilt distribution](https://github.com/lydell/node-pty): genuine pseudoterminal transport. Query: `github lydell node-pty prebuilt npm`. Version pinned to `@lydell/node-pty@1.1.0`, installed and exercised in the local PTY test.

Live authenticated Claude, Codex, Gemini, OpenCode, Aider and Cursor terminal sessions: **not verified**, no authenticated agent sessions were used. Automated coverage uses a real PTY with a deterministic agent fixture and representative notification payloads.
