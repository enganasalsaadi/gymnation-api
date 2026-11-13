# gymnation-api

HTTP API for gym membership invoicing and gateway reconciliation across the UAE, Saudi Arabia and Bahrain. It is the GymNation engineering take-home: members with E.164 phone normalization, plans and agreements with prorated VAT invoices, and reconciliation of card-gateway batches against expected invoices.

> **Status:** All three Parts are built and tested: members and phones, plans/agreements/invoices, and reconciliation. The Postman collection is included. The checklist below is updated after each milestone.

## Status

| Milestone | State |
|---|---|
| Spec, business rules and edge-case list ([CLAUDE.md](CLAUDE.md)) | Done |
| Project scaffold (TypeScript, Fastify, Vitest, Dockerfile) | Done |
| Part 1: `POST /members`, `GET /members/lookup` | Done |
| Part 2: `POST /plans`, `POST /agreements`, `GET /agreements/:id/invoices` | Done (both golden examples pass) |
| Part 3: `POST /reconciliation/runs`, `GET /reconciliation/runs/:id` | Done |
| `NOTES.md`, `PROMPTS.md`, Postman collection | Done ([gymnation-api.postman_collection.json](gymnation-api.postman_collection.json), 32 requests) |
| Both Docker builds verified locally | Done for all Parts (285 tests pass in the test target, runtime image 63 MB, starts with `--network none`, every Postman request passes against the container) |

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
   - [tests/reconciliation.test.ts](tests/reconciliation.test.ts): unit tests for row errors and matching (every verdict, ±1 tolerance, earliest-due-date tie-break, sorting, shuffled rows)
   - [tests/reconciliation-runs.test.ts](tests/reconciliation-runs.test.ts): HTTP tests for Part 3, including `INVALID_ROWS`, FIRST plus invoice 2 in one month, the declined-only invoice, and GET returning the identical body
4. **Manual walkthrough:** see [Postman](#postman) below.
5. **AI usage:** [PROMPTS.md](PROMPTS.md) logs the AI conversations used to build this. [.claude/](.claude/README.md) holds the skills the AI used, and [CLAUDE.md](CLAUDE.md) holds the rules it followed.

## Postman

1. Start the API: `docker run --rm -p 8080:8080 gymnation-api`.
2. In Postman, choose **Import** and select [gymnation-api.postman_collection.json](gymnation-api.postman_collection.json).
3. Run folder **1. Happy path** in order: Health, Create Member, Lookup Member, Create Plan, Create Agreement, List Invoices, Create Reconciliation Run, Read Reconciliation Run. Each request has test scripts, and the returned ids are saved in the collection variables `memberId`, `agreementId` and `runId`.
4. Run folder **2. Validation and error examples**. It uses the records from step 3, and each request checks its status and error code.
5. Restart the container to reset all state.

`baseUrl` defaults to `http://localhost:8080`. The collection is a manual client and does not reproduce the hidden grader.

## Repository map

| Path | Purpose |
|---|---|
| [GymNation_Prompt.md](GymNation_Prompt.md) | Full engineering spec derived from the brief |
| [CLAUDE.md](CLAUDE.md) | Business rules, never-forget edge cases, engineering rules |
| [PROMPTS.md](PROMPTS.md) | AI conversation log |
| [NOTES.md](NOTES.md) | How to run, what was skipped, one line per assumption |
| [Dockerfile](Dockerfile) | Stages `deps`, `build`, `test` and `runtime` (default) |
| [.claude/](.claude/README.md) | The Claude Code skills used to build the repo (rules are in `CLAUDE.md`) |
| [src/domain/](src/domain/) | Pure logic with no I/O: countries, phones, calendar dates, money rounding, invoice schedule, reconciliation |
| [src/http/](src/http/) | Fastify app, error envelope and routes |
| [src/store.ts](src/store.ts) | In-memory `Map` state with synchronous uniqueness checks |
| [tests/](tests/) | Vitest unit tests and HTTP tests (`app.inject`, fresh app per test) |
| [gymnation-api.postman_collection.json](gymnation-api.postman_collection.json) | Postman collection: happy path plus every error case |
