# Add Jupiter agent skills submodule

## Goal

Pin `jup-ag/agent-skills` beneath a reusable root `submodules/` directory and
expose its `skills/` through `.agents/skills` so compatible coding agents can
discover them. Document clone, update, review, and Docker-context behavior.

## Milestones

- [x] Inspect repository state, project guidance, existing submodule/agent paths,
      and upstream skill layout. Worktree was clean at `a0a97d7`.
- [x] Add the upstream Git submodule under `submodules/` and a relative
      `.agents/skills` symlink.
- [x] Document how to initialize/update the pinned skills and keep them out of
      the application Docker build context.
- [x] Verify the submodule pin, symlink target, formatting, and final diff.

## Constraints

- Do not install upstream plugins or run their scripts; expose only the skill
  definitions requested by the user.
- Keep the submodule at its reviewed commit until explicitly updated.
- Do not commit or push unless separately requested.

## Validation

- `git submodule status --recursive` reports pin
  `a2211e3f6a7caa03310c7a9a8d816e723b0bdc5f` with no submodule modifications.
- `.agents/skills` is a relative symlink to the submodule's `skills/`, and all
  four upstream `SKILL.md` files are discoverable through it.
- `npm run format:check` and `git diff --check` passed.
- Runtime tests/build were not run: no application source or runtime dependency
  changed. `.dockerignore` now excludes the agent-only directories.

No implementation work remains.
