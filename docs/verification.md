# Verification, 2026-10-28

Checked on macOS arm64 with Node **24.16.0** and npm **11.13.0**. This is the current verification record; it supersedes earlier reports about a missing GIF and an unpublished redo fix.

## README and recording

The README has **670 whitespace-separated words**, five features, four FAQ entries and two quick-start shell blocks. Its local links and guide anchors resolve. The opening now goes directly from the recorded demo to installation and use. Runtime code, dependencies, tests and CI configuration did not change.

The existing `docs/demo.gif`, added in commit `dd1fda7`, is retained unchanged:

```text
$ ffprobe -v error -show_entries format=duration,size -of json docs/demo.gif
{
    "format": {
        "duration": "14.160000",
        "size": "148302"
    }
}
```

The GIF is 1100 × 580 with 354 frames. Sampled frames show readable terminal commands, broken app and `.env` contents, undo, restored app/`.env`/deleted notes, and redo. `docs/demo.tape` and its fixture remain in the repository. The demo runs a deterministic script that edits files; it does not call an AI service.

`vhs validate docs/demo.tape` exited 0. A fresh execution of the tape's setup, CLI commands and assertions exited 0:

```text
demo broken: PASS
Restored #1. Previous files saved as #2.
Run turnback redo to reapply.
app works
MODE=development
do not lose this
demo restored: PASS
Restored #2. Previous files saved as #1.
Run turnback undo to go back.
demo broken: PASS
```

Fresh recording in this environment remains **not verified**. The attempt failed before capturing frames, leaving the existing GIF unchanged:

```text
$ vhs docs/demo.tape
File: docs/demo.tape
recording failed
could not start browser: browser exited unexpectedly before its debugging endpoint was ready
```

Exit status: 1. Re-recording requires an environment where VHS can start Chromium. This does not prevent inspecting the existing GIF or executing the demonstrated recovery workflow.

## Tests and clean installation

The unchanged baseline and a fresh source copy without `.git` or `node_modules` both passed:

```text
$ npm test
tests 24
suites 0
pass 24
fail 0
cancelled 0
skipped 0
todo 0
```

In that clean copy, `npm ci` exited 0 with `added 2 packages, and audited 3 packages` and `found 0 vulnerabilities`. `npm run demo`, `npm pack --dry-run` and `npm install --global --install-links .` also exited 0. The local installation was a complete package directory, not a symlink to the checkout.

From an empty directory with a new temporary npm prefix and cache:

```text
$ npm install --global --install-links github:itzjk/turnback
added 3 packages in 3s
clean GitHub install: PASS
```

Only the npm prefix, cache and PATH were redirected to temporary directories; no global installation was changed. The default npm cache was not writable in this environment, so the initial pack attempt failed with `EPERM`; rerunning with the isolated cache succeeded.

All README CLI commands were executed against the installed local package: `watch -- codex`, `checkpoint`, `list`, `diff`, `diff 1`, `undo`, `redo`, `restore 1` and `--cwd ./project undo`. The `codex` executable was a deterministic stand-in. Assertions checked restored file contents, recovery of ignored `.env` and deleted notes, removal of new files, redo, preserved dependencies and identical hashes of `.git` contents:

```text
undo recovery: PASS
redo recovery: PASS
all README CLI commands and unchanged .git: PASS
```

The separately installed CLI passed the real PTY test, including two submissions, resizing and sequential undo/redo:

```text
tests 1
pass 1
fail 0
skipped 0
installed CLI, real PTY two turns: PASS
```

## Independent README review

A second agent followed the README from fresh directories and installed both the exact GitHub command and a separately packed local tarball. Both passed the documented commands, subdirectory discovery, numbered restore and undo of restore, plus the FAQ's redo-after-manual-checkpoint scenario. All seven runtime/package files matched between GitHub and local source. All **22 fixture `.git` files** retained identical SHA-256 hashes through the full scenario.

The reviewer independently passed the installed CLI's real PTY test: one test, zero failures or skips. It inspected GIF frames, checked README links and guide anchors, and found no personal-path, token or private-key pattern matches in tracked public files. Store directory permissions were `0700`; the index was `0600`. Its only finding was the stale verification report, replaced by this record.

## Coverage and remaining limits

The suite covers ignored-file recovery, deletion and new-file recovery, multiple undo/redo steps, pending redo after checkpointing manual edits, `.git` invariance, exclusions, symlink boundaries, binary files, modes, corruption, injected write failures, interrupted restore recovery and rolling retention. Existing redo regression tests remain unchanged.

Live authenticated coding-agent sessions, remote CI execution, Linux and x64 runtime behavior, power-loss recovery, network filesystems and hostile concurrent writers are **not verified in this review**. CI remains configured for macOS and Ubuntu with Node 22 and 24. Python 3 is needed for the PTY test driver, not for runtime use.

Nothing was pushed or published.
