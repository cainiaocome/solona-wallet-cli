# Jupiter skills for coding agents

This repository pins [Jupiter's agent-skills repository](https://github.com/jup-ag/agent-skills)
as a Git submodule at `submodules/jup-ag-agent-skills`. The link
`.agents/skills` points to the submodule's `skills/` directory, so compatible
coding agents can discover those skill definitions from this project without
copying or installing them individually.

The current upstream pin includes `integrating-jupiter`, `jupiter-lend`,
`jupiter-vrfd`, and `jupiter-swap-migration`. The submodule commit is recorded
by this repository; it will not move just because upstream publishes changes.

## Initialize after cloning

For a new clone, initialize submodules as part of the clone:

```sh
git clone --recurse-submodules <repository-url>
```

If you already cloned without submodules, run this from the project root:

```sh
git submodule update --init --recursive
```

Check the pinned revision and that the skill link resolves:

```sh
git submodule status
ls .agents/skills
```

The `.agents/skills` entry is a relative symlink tracked by this repository.
It does not contain a second copy of the upstream files. If a normal clone has
not initialized the submodule yet, the link will be temporarily dangling; the
initialization command above fills in its target.

## Update the upstream pin deliberately

Treat skill content as external instructions: review changes before making
them available to agents. To move to the latest commit on the upstream default
branch:

```sh
git submodule update --remote submodules/jup-ag-agent-skills
git diff --submodule=log -- submodules/jup-ag-agent-skills
```

Review the upstream commit and the changed `SKILL.md` files, then stage and
commit the new submodule pointer in this repository. Until that pointer is
committed, other clones continue to use the previous revision. To restore the
currently committed pin in a local checkout, run:

```sh
git submodule update --init --recursive
```

To add another Git submodule later, use a descriptive path under `submodules/`
and document its purpose and initialization/update process. If it provides
Agent Skills-format folders, add an explicit link under `.agents/skills/`
rather than copying the skill files.

## Scope and build behavior

Only the upstream `skills/` directory is exposed to coding agents. This does
not install Jupiter's provider-specific plugins and does not run the upstream
`scripts/install_plugin.sh` installer. Agents should consult the relevant
`SKILL.md` when a task calls for that skill, and should still follow this
project's `AGENTS.md`, security rules, and user instructions.

The `.dockerignore` excludes both `.agents/` and `submodules/`. These files are
development guidance, not part of the wallet CLI runtime or its test image, so
Docker builds and CI do not need to fetch or package the submodule.
