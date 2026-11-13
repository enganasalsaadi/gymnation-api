# AI Prompts Log

This file logs the AI conversations used to build this project, with the reason for each one.

## Session 1 (2026-11-13): Spec review, project rules, skills

- **Tool:** Claude Code (Claude Opus 5.5)
- **Prompt:** "Find the best skills for this task, write the rules that are important for the business and the cases we must never forget, and update README.md so the reviewer can check." The prompt pointed to `GymNation_Prompt.md` and the brief URL.
- **What the AI did:**
  - Compared `GymNation_Prompt.md` with the original brief and fixed these problems:
    - LaTeX formulas were corrupted into control characters (`\t`, `\f`, `\r`). They were rewritten as plain-text formulas.
    - The UAE E.164 length was wrong (it is 13 characters, not 12).
    - The `201` status for reconciliation runs and the "GET returns the identical body" rule were missing.
    - Worked examples were added with their N, P, D and C values.
  - Wrote `CLAUDE.md`: business rules, Fastify traps (400→422, ajv type coercion), the concurrency rule (no `await` between check and insert), the never-forget edge-case checklist, and open assumptions.
  - Searched the skills.sh registry and picked these skills: `fastify-best-practices`, `tdd`, `vitest`, `multi-stage-dockerfile`.
- **Why:** to fix the contract and every edge case in one place before writing code, because the hidden grader checks exact status codes and integer results.

## Session 2 (2026-11-13): Scaffold and Part 1

- **Tool:** Claude Code (Claude Opus 5.5) with the `fastify-best-practices`, `tdd` and `vitest` skills
- **Prompt:** "Install the 4 skills, then ask me any questions before the build." The candidate answered three questions:
  - Reject `+97105…` (trunk 0 after the dial code).
  - Commit after each milestone but never push.
  - Stop after each Part for review.
- **What the AI did:**
  - Installed 3 of the 4 skills. `multi-stage-dockerfile` failed twice (the GitHub download timed out), so the Dockerfile was written by hand.
  - Scaffolded the project: TypeScript strict, Fastify 5, Vitest 4, and Node 22 LTS (Node 20 is end-of-life).
  - Generated the lockfile with npm 11 to avoid an npm 10 peer-dependency crash. `npm ci` still works on npm 10.
  - Wrote the Part 1 tests first, then the implementation:
    - Phone parsing as a pure function.
    - One error handler that maps Fastify's 400/415 to `422 VALIDATION`.
    - Synchronous check-and-insert for phone uniqueness.
  - Verified both Docker builds and a smoke test of the running container.
- **Why:** each Part is graded separately, so Part 1 was finished and verified end to end before starting Part 2.
