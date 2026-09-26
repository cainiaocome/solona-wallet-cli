# npm supply-chain controls

This project uses two complementary controls for JavaScript dependencies:

1. `package-lock.json` records the exact dependency tree that was reviewed and
   tested.
2. `.npmrc` sets `min-release-age=7`, which restricts npm's dependency
   resolution and update operations to versions older than seven days.

The npm setting is the project equivalent of:

```bash
export NPM_CONFIG_MIN_RELEASE_AGE=7
```

The official npm configuration calls this value a number of **days**. The
repository uses the project file so the setting applies when developers resolve
or update dependencies without an overriding environment variable. GitHub
Actions sets the same value explicitly, and Docker verifies the configured
value before installation.

## Why both controls matter

The lockfile and release-age policy solve different problems:

- The lockfile makes `npm ci` reproduce the versions selected when that
  lockfile was created.
- The release-age policy restricts npm's resolution when generating or changing
  a dependency tree.
- CI and Docker check that the policy is configured, but this check does not
  inspect the publish age of each version already in the lockfile.

Neither control proves that a dependency is safe. An older package can be
compromised, a maintainer can publish malicious code, or a registry account can
be attacked. Review, audit, small dependency surface, exact lockfiles, and
reproducible CI remain necessary.

## Normal installation

Use the project command to reproduce the committed dependency tree:

```bash
npm ci --legacy-peer-deps
```

Confirm the effective policy with:

```bash
npm config get min-release-age
```

It should print `7`. This confirms the configured value only; it does not
prove that locked packages meet the age window. In particular, `npm ci` is a
lockfile reproduction command. Do not describe its success as a behavioral
test of the package-age filter.

To check the project file without a user-level environment variable affecting
the result:

```bash
env -u NPM_CONFIG_MIN_RELEASE_AGE npm config get min-release-age
```

The repository's `.npmrc` should still make this print `7`.

During a dependency update, use a resolver operation and verify its behavior
against the configured registry. For example:

```bash
npm install --package-lock-only --legacy-peer-deps
```

That command may leave the lockfile unchanged; review its output and the
resulting diff. Keep in mind that npm also honors higher-priority user, global,
environment, and command-line settings.

The earlier version of this guide described `npm ci` as an age enforcement
check. An offline experiment with a 100,000-day override still allowed
`npm ci --dry-run` to use the existing lockfile, so that claim was incorrect.
The workflow's config checks verify that `7` is set; they are not a publish-age
audit of the lockfile.

## Updating a dependency

When intentionally changing dependencies:

1. Review the package's release history, changelog, maintainer, and advisories.
2. Keep `min-release-age=7` enabled. Wait until the desired release is old
   enough unless there is a documented emergency reason not to.
3. Update the manifest deliberately, then regenerate the lockfile with the
   required peer-dependency option.
4. Run `npm ci --legacy-peer-deps` from a clean dependency directory.
5. Run formatting, unit tests, lint, build, Docker build, and the GitHub Docker
   E2E workflow.
6. Review the complete lockfile diff and run `npm audit --omit=dev`.
7. Update the version list and dependency-risk documentation when the change
   affects the runtime graph.

For this repository's Jupiter SDK, dependency updates also require checking
the adapter API and instruction conversion. Do not use `npm audit fix` blindly;
an automatic upgrade can change protocol behavior or break the intentional
legacy-SDK isolation.

## When the policy blocks an update

The expected result is an install error if no version satisfying both the
lockfile/request and the seven-day window is available. That is a safety stop,
not a reason to weaken the rule immediately.

First check whether:

- the package was published recently and waiting is appropriate;
- the requested version is actually present in `package-lock.json`;
- the registry or local package-time cutoff is behaving as expected;
- an older compatible version can be used temporarily.

If an urgent security fix is newer than seven days, record the reason and
review the exception with the same care as a dependency change. A one-off
override can be made with a higher-priority npm setting, for example:

```bash
NPM_CONFIG_MIN_RELEASE_AGE=0 npm install <package>@<version> --legacy-peer-deps
```

That command intentionally bypasses the project policy for that invocation. It
must not be copied into the Dockerfile or CI workflow, and the resulting
manifest and lockfile must receive normal review. If the update is not urgent,
wait seven days instead.

## CI and Docker enforcement

The GitHub workflow sets `NPM_CONFIG_MIN_RELEASE_AGE=7`, verifies npm reports
`7`, and then runs `npm ci`. The Docker build copies `.npmrc` before its
install step and runs the same configuration check. These checks prevent a
missing policy setting; they do not independently verify the locked versions'
publish dates. The lockfile is the artifact those builds install.

The production image does not need `.npmrc` at runtime; it only needs the
already-installed production dependencies. The policy is a build-time control.

## Current project limitations

- `package-lock.json` is committed, but npm package metadata is still obtained
  from the configured registry during a fresh install.
- No lockfile signature or private registry mirror is configured.
- The pinned Jupiter SDK graph currently has documented upstream transitive
  audit advisories.
- The seven-day window can delay a legitimate security fix; that tradeoff must
  be handled deliberately rather than silently bypassed.

Read [security-and-testing.md](security-and-testing.md) for the broader threat
model and [implementation.md](implementation.md) for the dependency bootstrap
history.
