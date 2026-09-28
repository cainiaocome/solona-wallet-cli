# Terminal presentation refresh

## Goal

Make human-readable CLI output easier to scan with accessible semantic color,
clearer status/help layouts, aligned key/value rows, and terminal-width-aware
tables. Keep JSON contracts unchanged and do not add command-buffer syntax
highlighting.

## Completed

- Added shared terminal styling, TTY/`NO_COLOR`/`TERM=dumb` handling, and
  readline-safe prompt colors.
- Refreshed startup and prompt identity, grouped help, status dashboard,
  Jupiter Lend status, wallet/read-only views, write previews, receipts,
  confirmations, progress, and error labels.
- Made human tables adapt to narrow terminals without truncating full values.
- Added tests for color policy, prompt escapes, width-aware tables, help size,
  status section ordering/amount labels, JSON cleanliness, and color/no-color
  Docker PTY behavior.
- Added [terminal output guidance](docs/terminal-output.md) and updated the
  command-output and testing documentation.

## Decisions and constraints

- Color only applies to TTY output; meaningful labels remain in plain text.
- Do not alter JSON schemas or include ANSI sequences in machine output.
- No command-buffer syntax highlighting and no chain transactions in this work.
- No dependencies or system packages were installed or modified.

## Validation

- `npm test`: 100 tests passed across 21 files.
- `npm run lint`, `npm run build`, `npm run format:check`,
  `python3 -m black --check test/e2e`, and `git diff --check` passed.
- `linux/amd64` Docker image build passed; 22 Docker E2E tests passed against
  that image, including interactive prompt color and `NO_COLOR` coverage.
- Docker/npm emitted known builder deprecation, peer/install-script, and audit
  warnings; no warning blocked the build or tests. Full details are in
  [security and testing](docs/security-and-testing.md).

No implementation work remains. The terminal-presentation refresh is complete.
