# AI setup used to build this repo

This project was built with Claude Code. This folder shows the reviewer exactly what guided the AI.

## Rules

The project rules are in [../CLAUDE.md](../CLAUDE.md) at the repo root. Claude Code loads that file automatically at the start of every session. It holds:

- the runtime contract and error envelope,
- the business rules for Parts 1, 2 and 3,
- the never-forget edge cases, each of which has a test,
- the engineering rules and the agreed workflow.

## Skills

These are copies of the skills that were used while writing the code. Claude Code loads skills from `.claude/skills/` in a project, so anyone who opens this repo in Claude Code gets the same guidance.

| Skill | Source | Used for |
|---|---|---|
| [fastify-best-practices](skills/fastify-best-practices/SKILL.md) | [mcollina/skills](https://github.com/mcollina/skills) | Routes, JSON schemas, the error handler, `inject()` tests |
| [tdd](skills/tdd/SKILL.md) | [mattpocock/skills](https://github.com/mattpocock/skills) | Writing the tests first for each rule |
| [vitest](skills/vitest/SKILL.md) | [antfu/skills](https://github.com/antfu/skills) | Vitest config and test APIs |
| [codebase-design](skills/codebase-design/SKILL.md) | [mattpocock/skills](https://github.com/mattpocock/skills) | Keeping the domain logic in small pure modules |

The Dockerfile was written by hand. A Docker skill was tried but failed to install.

The conversations themselves are logged in [../PROMPTS.md](../PROMPTS.md).

Nothing in this folder is copied into the Docker image.
