# gymnation-api

HTTP API for gym membership invoicing and gateway reconciliation across the UAE, Saudi Arabia and Bahrain. It is the GymNation engineering take-home: members with E.164 phone normalization, plans and agreements with prorated VAT invoices, and reconciliation of card-gateway batches against expected invoices.

> **Status:** Parts 1 (members and phones) and 2 (plans, agreements, invoices) are built and tested. Part 3 is next. The checklist below is updated after each milestone.

## Status

| Milestone | State |
|---|---|
| Spec, business rules and edge-case list ([CLAUDE.md](CLAUDE.md)) | Done |
| Project scaffold (TypeScript, Fastify, Vitest, Dockerfile) | Done |
| Part 1: `POST /members`, `GET /members/lookup` | Done |
| Part 2: `POST /plans`, `POST /agreements`, `GET /agreements/:id/invoices` | Done (both golden examples pass) |
| Part 3: `POST /reconciliation/runs`, `GET /reconciliation/runs/:id` | Not started |
| `NOTES.md`, `PROMPTS.md`, Postman collection | `NOTES.md` and `PROMPTS.md` kept current, Postman not started |
| Both Docker builds verified locally | Done for Parts 1 and 2 (205 tests pass in the test target, runtime image 63 MB, starts with `--network none`) |

## Run it

Requirements: Docker. Node 20 or newer is needed only to run outside Docker. The image uses Node 22 LTS.

```bash
# Run the test suite inside Docker (exits 0 on success)
docker build --target test -t gymnation-api:test .

# Build and start the API on port 8080
docker build -t gymnation-api .
docker run --rm -p 8080:8080 gymnation-api

# Check that it is up
curl http://localhost:8080/health      # {"status":"ok"}
```

Without Docker:

```bash
npm ci
npm test
npm run build && npm start
```

State is held in memory. Restarting the container resets it to empty, and no data is seeded.

## API

| Method | Path | Success | Business errors |
|---|---|---|---|
| GET | `/health` | 200 | |
| POST | `/members` | 201 | 422 `INVALID_PHONE`, 409 `PHONE_TAKEN` |
| GET | `/members/lookup?phone=&country=` | 200 | 422 `PHONE_NEEDS_COUNTRY`, 422 `PHONE_COUNTRY_MISMATCH`, 404 |
| POST | `/plans` | 201 | 409 `PLAN_EXISTS` |
| POST | `/agreements` | 201 | 422 `UNKNOWN_MEMBER` / `UNKNOWN_PLAN` / `PLAN_COUNTRY_MISMATCH` |
| GET | `/agreements/:id/invoices?from=&to=` | 200 | 422 `INVALID_RANGE`, 404 |
| POST | `/reconciliation/runs` | 201 | 422 `INVALID_ROWS` |
| GET | `/reconciliation/runs/:id` | 200 | 404 |

Every error uses `{"error": {"code", "message"}}`. Malformed input returns `422 VALIDATION`, and an unknown id in the URL returns `404 NOT_FOUND`.

## How to review

1. **Rules and edge cases:** [CLAUDE.md](CLAUDE.md) lists every business rule, the golden numbers, and the edge cases that each have a test.
2. **Assumptions:** `NOTES.md` has one line per assumption where the brief is silent.
3. **Tests:** run `docker build --target test .` (typecheck plus every test). The test files are:
   - [tests/phone.test.ts](tests/phone.test.ts): unit tests for phone parsing (spellings A, B and C, and every invalid shape)
   - [tests/members.test.ts](tests/members.test.ts): HTTP tests for `POST /members` and lookup, including the concurrent-spellings race
   - [tests/http.test.ts](tests/http.test.ts): health, the 404 envelope, and bad JSON returning 422
   - [tests/dates.test.ts](tests/dates.test.ts), [tests/money.test.ts](tests/money.test.ts): strict date parsing, clamping, leap years, half-up rounding
   - [tests/invoices.test.ts](tests/invoices.test.ts): both golden examples, full-price starts, due_day 31 clamping, mid-history windows, BHD fils
   - [tests/plans.test.ts](tests/plans.test.ts), [tests/agreements.test.ts](tests/agreements.test.ts): HTTP tests for Part 2, including the 366/367-day range boundary and the concurrent duplicate plan id
4. **Manual walkthrough:** import `gymnation-api.postman_collection.json` into Postman, start the container, and run the requests in order: Health, then Member, Plan, Agreement, Invoices, Reconciliation run, and Read run. The collection saves the returned ids into variables for later requests. Restart the container to reset state. The collection is a manual client and does not reproduce the hidden grader.
5. **AI usage:** [PROMPTS.md](PROMPTS.md) logs the AI conversations used to build this. [.claude/](.claude/README.md) holds the skills the AI used, and [CLAUDE.md](CLAUDE.md) holds the rules it followed.

## Repository map

| Path | Purpose |
|---|---|
| [GymNation_Prompt.md](GymNation_Prompt.md) | Full engineering spec derived from the brief |
| [CLAUDE.md](CLAUDE.md) | Business rules, never-forget edge cases, engineering rules |
| [PROMPTS.md](PROMPTS.md) | AI conversation log |
| [NOTES.md](NOTES.md) | How to run, what was skipped, one line per assumption |
| [Dockerfile](Dockerfile) | Stages `deps`, `build`, `test` and `runtime` (default) |
| [.claude/](.claude/README.md) | The Claude Code skills used to build the repo (rules are in `CLAUDE.md`) |
| [src/domain/](src/domain/) | Pure logic with no I/O: countries, phones, calendar dates, money rounding, invoice schedule |
| [src/http/](src/http/) | Fastify app, error envelope and routes |
| [src/store.ts](src/store.ts) | In-memory `Map` state with synchronous uniqueness checks |
| [tests/](tests/) | Vitest unit tests and HTTP tests (`app.inject`, fresh app per test) |
