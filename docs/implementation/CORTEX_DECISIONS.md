# Cortex Architecture Decisions

Newest first. Records significant decisions so future work does not undo sound
architecture. Each entry: decision, alternatives, why, tradeoffs, consequences.

## Rename applies edits itself for closed files rather than relying on Monaco

- **Decision:** the rename provider returns only the active file's edits to
  Monaco and applies edits to every other affected file directly (disk write +
  open-tab sync), refusing when a cross-file target has unsaved changes.
- **Alternatives:** (a) return the whole workspace edit to Monaco and let it
  apply; (b) open a model for every affected file first.
- **Why:** standalone Monaco only applies workspace edits to models that are
  loaded, and Cortex keeps one live model at a time, so (a) would silently drop
  edits to closed files. (b) is heavy and still would not update the store's tab
  content. The server also only sees the active file's live buffer, so applying
  its computed offsets to an unsaved other file could corrupt it, hence the
  refuse-on-dirty guard.
- **Tradeoffs:** cross-file edits are written to disk immediately (not undoable
  as one Monaco action); the active file stays undoable.
- **Consequences:** the edit-application is a pure shared helper
  (`src/shared/textEdit.ts`) the AI agent will reuse for its file-edit tool.

## Git account pinned per-repo to avoid the credential picker

- **Decision:** `credential.https://github.com.username = Blasted-ctrl` set in
  the repo's local git config.
- **Why:** multiple GitHub identities are stored on the machine (Blasted-ctrl
  and an x-access-token identity), so Git Credential Manager prompted "Select an
  account" on every push and blocked non-interactive pushes.
- **Consequences:** pushes are non-interactive; this is local to the Cortex repo
  and does not change the user's global git config.

## Turbo (Claude edition) and Taste-Skill are the process, installed globally

- **Decision:** Turbo's Claude-edition skills and the Taste-Skill set are
  installed to `~/.claude/skills/` (not committed to the Cortex repo).
- **Why:** they are a general engineering/design process, not Cortex source;
  the Claude edition is production-tested (the Codex edition is experimental and
  this is a Claude Code harness). Keeping them out of the repo avoids bloating it
  with ~80 third-party skill files.
- **Tradeoffs:** newly-copied skills register as slash commands only after a
  Claude Code restart, so mid-session they are used by following their SKILL.md
  directly. External prereqs (gh CLI auth, the Codex peer-review CLI) are not
  available in this environment; peer review is done with a multi-agent workflow
  instead.
