# Repository instructions

## Scope and ownership

This repository owns the separate Linear Todo intake plugin. Keep changes here
unless a new lot explicitly authorizes another repository. Paperclip core and
SDK sources are read-only references. Preserve every other chat's worktree,
runtime, configuration, and historical evidence.

The repository contains an implemented plugin. Keep the README's source,
qualification, installed-version and activation statements distinct and accurate.

## Implementation rules

- Read `docs/TODO-INTAKE-CONTRACT.md` and the active implementation lot first.
- Reuse supported native Paperclip contracts before introducing custom code.
- Prefer the managed Linear connector through a scoped native gateway; verify
  its actual tool schemas and complete read coverage before relying on it.
- Keep webhook handling, source retrieval, import, and admission deterministic.
  The importer must never wake an implementation agent directly.
- Persist identities and intent before effects. Reconcile an uncertain effect
  under its original identity; never bypass uncertainty with a replacement key.
- Keep imported work ineligible until the entire source family and its native
  readback are complete. An event is a signal, not durable proof of readiness.
- Store secret references only. Never commit credentials or expose secret values
  in logs, reports, command arguments, fixtures, or examples.
- Default to disabled configuration. Do not install, activate a webhook, import
  real tickets, launch provider runs, or change project authority as a side
  effect of development or qualification.
- Test meaningful boundaries: signatures, eligibility, pagination, duplicate
  events, partial effects, restart recovery, and the receiving workflow's gates.
- Keep source/build/fixture/runtime/provider evidence distinct. Report exactly
  which layer was exercised.

## Skills and generated prompts

Identify the minimum relevant skills at task start and after compaction.
`implementation-meta-flow`, `cross-repo-governance`, and `static-code-audit` are
relevant when their triggers match implementation, integration, and JS/TS work.
Use `git-safety` for a requested Git preflight. A Codex plugin authoring skill
does not automatically apply to a Paperclip runtime plugin.

For an agent/run prompt, include concise "Plugins/skills à utiliser" and
"Modele et effort recommandes" sections. Resolve the mapping from an explicitly
provided path, then this repository's
`shared/model-selection/model-effort-mapping.md`, then
`$CODEX_HOME/shared/model-selection/model-effort-mapping.md` (default
`~/.codex`). Report an absent mapping without inventing a selection. Preserve
explicit choices and distinguish recommendation from observed launch settings.
