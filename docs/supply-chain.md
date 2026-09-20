# npm supply-chain controls

This project uses two complementary controls for JavaScript dependencies:

1. `package-lock.json` records the exact dependency tree that was reviewed and
   tested.
2. `.npmrc` sets `min-release-age=7`, so npm will not select a package version
   published less than seven days ago.

The npm setting is the project equivalent of:

```bash
export NPM_CONFIG_MIN_RELEASE_AGE=7
```

The official npm configuration calls this value a number of **days**. The
repository uses the project file so the rule applies even when a developer has
not exported the variable in their shell. GitHub Actions sets the same value
explicitly, and the Docker build verifies it before running `npm ci`.

## Why both controls matter

The lockfile and release-age policy solve different problems:

- The lockfile prevents a normal `npm ci` from silently changing the resolved
  versions between runs.
- The release-age policy prevents a dependency update or an unconstrained
  transitive resolution from selecting a very fresh release.
- CI and Docker checks prevent the build environment from accidentally using a
  different npm policy than local development.

Neither control proves that a dependency is safe. An older package can be
compromised, a maintainer can publish malicious code, or a registry account can
be attacked. Review, audit, small dependency surface, exact lockfiles, and
reproducible CI remain necessary.

## Normal installation

Use the project command:

```bash
npm ci --legacy-peer-deps
```

Confirm the effective policy with:

```bash
npm config get min-release-age
```

It should print:

```text
7
```

To check the project file without a user-level environment variable affecting
the result:

```bash
env -u NPM_CONFIG_MIN_RELEASE_AGE npm config get min-release-age
```

The repository's `.npmrc` should still make this print `7`.

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
install step and runs the same configuration check. This matters because a
Docker build does not automatically inherit the developer's shell environment.

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
