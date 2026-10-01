# Interactive history recall

## Goal and implementation

- Correct readline history ordering: disk entries remain oldest-first, but each
  fresh readline interface receives a reversed copy, newest-first.
- Preserve history display, persistence limits, and secret filtering.
- Added Docker PTY regression coverage for Up/Down after Jupiter Lend status
  and recall after restarting the shell.
- User requested commit/push; local validation complete, publication pending.

## Validation

- All 121 unit tests, TypeScript lint/build, and all three Docker REPL PTY tests
  passed against the rebuilt `sol-wallet:history-e2e` image.
- Prettier, Python Black, and diff whitespace checks passed.
- Initial PTY run failed because the new assertion expected a network guard
  instead of the existing no-wallet error; corrected the assertion and reran
  all three successfully. Existing Python socket/forkpty warnings remain.
- No chain writes or package installations performed.
