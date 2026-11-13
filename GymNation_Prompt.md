# Master Engineering Prompt: GymNation Gulf Membership & Reconciliation API
**Role:** Senior Staff Software Engineer & Solutions Architect  
**Target Stack:** Node.js (v20+ LTS), TypeScript (strict mode), Fastify, Vitest, in-memory Map repositories, integer/BigInt money arithmetic, multi-stage Dockerfile.  
**Audience:** LLM Code Generator / Coding Assistant (Cursor, Claude, Lovable)

---

## 1. System Context & Objective
You are tasked with building a high-performance, rock-solid HTTP REST API that manages gym membership subscriptions across the Gulf region (UAE, Saudi Arabia, Bahrain), generates invoices on-the-fly according to strict proration and VAT rules, and reconciles payments against payment gateway transaction batches.

This API will be evaluated by an automated scoring engine that replays hundreds of edge-case and concurrent requests. Any deviation from the contract, wrong status code, or rounding flaw will fail the evaluation.

---

## 2. Hard Contract & Runtime Constraints
These rules must hold unconditionally:
1. **Container & Ports:**
   - A `Dockerfile` at the repository root.
   - Standard build & run:
     ```bash
     docker build -t app .
     docker run -p 8080:8080 app
     ```
   - Must listen on `0.0.0.0:8080`.
   - `GET /health` must return `200 OK` (e.g. `{"status": "ok"}`) within 60 seconds of startup.
   - Multi-stage build with target `test`: `docker build --target test .` must run all automated tests and exit with code 0.
2. **Offline Runtime (Zero Network):**
   - The container will have NO internet connectivity at runtime. All dependencies must be bundled during the build stage.
   - Persistence must be in-memory or embedded (e.g., in-memory SQLite / Mutex-protected Map).
   - Every container restart starts completely empty.
3. **Data Formats:**
   - **Dates:** `YYYY-MM-DD` strictly, with no time or timezone offset.
   - **Currencies & Money:** Always represented as **integers in minor units** (fils, halalas). Never use floating point numbers for currency math. Every invoice must declare its ISO currency.
   - **IDs:** Generated IDs must be unique strings (UUID v4 or nanoid). Caller-provided IDs (like plan ID) must be preserved as provided.
4. **Error Handling Contract:**
   - All errors must follow this exact JSON envelope:
     ```json
     {
       "error": {
         "code": "<ERROR_CODE>",
         "message": "<Human-readable description>"
       }
     }
     ```
   - Malformed input (missing fields, invalid types, invalid date syntax, out of bounds): HTTP `422` with code `"VALIDATION"`.
   - Unknown ID in URL parameter: HTTP `404` with code `"NOT_FOUND"`.
   - Business errors must use the exact HTTP status codes and error code strings defined in Parts 1, 2, and 3.
5. **Concurrency & Race Conditions:**
   - The server must handle concurrent requests safely.
   - Any rule stating something "may not" happen (e.g. two members with the same normalized phone number) must hold even when two requests race simultaneously.

---

## 3. Country & Currency Specification
| Country | Code | Dial Code | Currency | Minor Units Ratio | VAT Rate | National Mobile Regex | E.164 Format |
|---|---|---|---|---|---|---|---|
| United Arab Emirates | AE | 971 | AED | 100 fils = 1 AED | 5% | `^05\d{8}$` (10 digits starting with `05`) | `+9715XXXXXXXX` (12 chars total) |
| Saudi Arabia | SA | 966 | SAR | 100 halalas = 1 SAR | 15% | `^05\d{8}$` (10 digits starting with `05`) | `+9665XXXXXXXX` (13 chars total) |
| Bahrain | BH | 973 | BHD | 1000 fils = 1 BHD | 10% | `^3\d{7}$` (8 digits starting with `3`, no trunk 0) | `+9733XXXXXXX` (12 chars total) |

---

## 4. Software Architecture & Clean Design Pattern
Implement the application following **Clean Architecture / Domain-Driven Design (DDD)** principles:

```
src/
├── domain/                    # Pure, deterministic domain logic (ZERO external framework dependencies)
│   ├── models/                # TypeScript interfaces and domain entities
│   │   ├── country.ts         # Country metadata, currencies, VAT rates
│   │   ├── member.ts          # Member entity
│   │   ├── plan.ts            # Plan entity
│   │   ├── agreement.ts       # Agreement entity & DueDate calculators
│   │   ├── invoice.ts         # Invoice calculation, proration & VAT math
│   │   └── reconciliation.ts  # Reconciliation candidate matching & verdict engine
│   ├── services/
│   │   ├── phone-normalizer.ts # Strict E.164 normalization, spelling rules & validations
│   │   ├── invoice-generator.ts# Invoices generator for date ranges (inclusive, max 366 days)
│   │   └── reconciler.ts      # Deterministic, order-independent reconciliation engine
│   └── errors/                # Typed domain errors with exact HTTP codes & error envelopes
├── infrastructure/            # Storage, concurrency controls, adapters
│   ├── storage/
│   │   ├── in-memory-db.ts    # Thread-safe in-memory database with async Mutex or SQLite
│   │   ├── member-repository.ts
│   │   ├── plan-repository.ts
│   │   ├── agreement-repository.ts
│   │   └── reconciliation-repository.ts
│   └── utils/
│   │   ├── math.ts            # Half-up rounding implementation
│   │   └── date.ts            # Leap year, month days, calendar clamping
├── presentation/              # HTTP Layer (Fastify or Express)
│   ├── server.ts              # Server factory & 0.0.0.0:8080 listener
│   ├── routes/
│   │   ├── health.ts          # GET /health
│   │   ├── members.ts         # POST /members, GET /members/lookup
│   │   ├── plans.ts           # POST /plans
│   │   ├── agreements.ts      # POST /agreements, GET /agreements/:id/invoices
│   │   └── reconciliation.ts  # POST /reconciliation/runs, GET /reconciliation/runs/:id
│   └── middleware/
│       ├── error-handler.ts   # Centralized JSON error envelope formatter
│       └── request-validator.ts # Schema validation (Zod or TypeBox)
└── index.ts                   # Application bootstrap
```

---

## 5. Detailed Domain Logic & API Specification

### Part 1: Members and Phone Normalization
#### Endpoint 1.1: `POST /members`
- **Request Body:**
  ```json
  { "name": "Noura Al Harbi", "country": "SA", "phone": "055 123 4567" }
  ```
- **Validations:**
  - `name`: Must be trimmed. After trimming, length must be between 1 and 120 characters. Returns trimmed name.
  - `country`: Must be one of `"AE"`, `"SA"`, `"BH"`.
  - `phone`:
    1. **Clean:** Remove all spaces, hyphens `-`, and round brackets `()`.
    2. Any remaining character other than digits and at most one leading `+` triggers `422 INVALID_PHONE`.
    3. Leading `00` prefix is strictly prohibited -> `422 INVALID_PHONE`.
    4. **Spellings Allowed:**
       - **Spelling A (E.164 with +):** `+` + dial code + valid national mobile.
       - **Spelling B (Dial code without +):** dial code + valid national mobile.
       - **Spelling C (National mobile):** Interpreted using the member's own `country`.
    5. On `POST /members`, international numbers may belong to any of the 3 Gulf countries (e.g. an expat in AE with a SA SIM).
    6. Stored phone MUST always be formatted as standard E.164: `+<dial_code><mobile>`.
- **Concurrency & Uniqueness:**
  - Phone uniqueness is strictly enforced against the normalized E.164 phone.
  - If phone already exists: HTTP `409` with code `"PHONE_TAKEN"`, and include `"existing_member_id": "<id>"` inside the `error` object:
    ```json
    {
      "error": {
        "code": "PHONE_TAKEN",
        "message": "Phone number is already registered",
        "existing_member_id": "mem_123"
      }
    }
    ```
  - **Critical:** When two concurrent requests submit the same phone in different spellings simultaneously, exactly one must succeed with 201, and the other must fail with 409 and return the winner's member ID.
- **Success Response:** HTTP `201 Created`
  ```json
  { "id": "uuid", "name": "Noura Al Harbi", "country": "SA", "phone": "+966551234567" }
  ```

#### Endpoint 1.2: `GET /members/lookup?phone=...&country=...`
- **Query Parameters:** `phone` (required), `country` (optional: AE, SA, BH).
- **Rules:**
  - If cleaned phone matches national shape of any country and `country` parameter is missing: HTTP `422 PHONE_NEEDS_COUNTRY`.
  - If `country` is provided and phone is national: must match that country's national mobile shape.
  - If phone is international (has dial code) and `country` parameter is provided, but dial code does NOT match country (e.g. dial 966 with country=AE): HTTP `422 PHONE_COUNTRY_MISMATCH`.
  - If no member is found for normalized phone: HTTP `404 NOT_FOUND`.
  - If found: HTTP `200 OK` returning the member object.

---

### Part 2: Plans and Invoice Schedule
#### Endpoint 2.1: `POST /plans`
- **Request Body:**
  ```json
  { "id": "anytime-sa", "country": "SA", "monthly": 29900, "joining_fee": 0 }
  ```
- **Rules:**
  - `id`: Chosen by caller. If duplicate ID exists -> HTTP `409 PLAN_EXISTS`.
  - `country`: AE, SA, BH.
  - `monthly`: Integer > 0 (in minor units, before VAT).
  - `joining_fee`: Integer >= 0 (in minor units, before VAT).
  - `currency` and `vat_rate` are automatically derived from `country`.
- **Response:** HTTP `201 Created`
  ```json
  { "id": "anytime-sa", "country": "SA", "currency": "SAR", "monthly": 29900, "joining_fee": 0 }
  ```

#### Endpoint 2.2: `POST /agreements`
- **Request Body:**
  ```json
  { "member_id": "...", "plan_id": "anytime-sa", "start_date": "2026-09-20", "due_day": 1 }
  ```
- **Rules:**
  - `due_day`: Integer between 1 and 31.
  - If `member_id` does not exist: HTTP `422 UNKNOWN_MEMBER`.
  - If `plan_id` does not exist: HTTP `422 UNKNOWN_PLAN`.
  - If member country != plan country: HTTP `422 PLAN_COUNTRY_MISMATCH`.
  - Generates unique agreement `id`.
- **Response:** HTTP `201 Created`

#### Endpoint 2.3: `GET /agreements/:id/invoices?from=YYYY-MM-DD&to=YYYY-MM-DD`
- **Rules:**
  - If agreement ID not found: HTTP `404 NOT_FOUND`.
  - `from` and `to` required. If `to < from` or `(to - from) > 366 days`: HTTP `422 INVALID_RANGE`.
  - Invoices are dynamically computed on-the-fly (NOT stored in database).
  - Invoices never end.
  - `invoice_no` is the position in the agreement's entire history (starts at 1). It does NOT reset inside the query range.
  - Filter output where `invoice.due_date >= from` and `invoice.due_date <= to` (inclusive).

#### Due Date Clamping Algorithm:
- In any given month `(year, month)`:
  `due_date = min(due_day, days_in_month(year, month))`
  *Example:* `due_day = 31` gives:
  - 31 Jan
  - 28 Feb (or 29 Feb in leap year)
  - 31 Mar
  - 30 Apr
  The anchor remains 31; only the calendar day clamps.

#### First Invoice (Invoice No. 1):
- `kind`: `"FIRST"`
- `due_date`: `start_date`
- Determine:
  - $N$: The first due date strictly after `start_date` ($N > 	ext{start\_date}$).
  - $P$: The due date exactly one month before $N$.
  - Days elapsed in cycle: $D = N - 	ext{start\_date}$ (in days).
  - Total days in cycle: $C = N - P$ (in days).
  - If `start_date` is itself a due date: $D = C$, ratio = 1 (full monthly price).
- **Rounding Rule (Round Half Up to Whole Minor Unit):**
  - Use exact math: `round_half_up(value) = Math.floor(value + 0.5)` for non-negative values.
  - Net prorated base: $	ext{prorated} = 	ext{round\_half\_up}\left( rac{	ext{monthly} 	imes D}{C} 
ight)$.
  - `net` = $	ext{prorated} + 	ext{joining\_fee}$.
  - `vat` = $	ext{round\_half\_up}(	ext{net} 	imes 	ext{vat\_rate})$.
  - `total` = $	ext{net} + 	ext{vat}$.
  - Note: Rounding occurs **exactly twice**: once for prorated net, once for VAT. Never round in major units.
  - `proration`: `{ "days": D, "cycle_days": C }`.

#### Subsequent Invoices (Invoice No. 2, 3, ...):
- `kind`: `"MONTHLY"`
- `invoice_no 2` is due on $N$.
- `invoice_no 3` is due on next month's due date, and so on.
- `net` = `monthly`.
- `vat` = $	ext{round\_half\_up}(	ext{net} 	imes 	ext{vat\_rate})$.
- `total` = $	ext{net} + 	ext{vat}$.
- `proration`: `null`.

---

### Part 3: Reconciling the Gateway File
#### Endpoint 3.1: `POST /reconciliation/runs`
- **Request Body:**
  ```json
  {
    "month": "2026-10",
    "rows": [
      {
        "gateway_txn_id": "T-88121",
        "agreement_id": "agr_1",
        "amount": 34385,
        "currency": "SAR",
        "status": "SETTLED",
        "attempted_on": "2026-10-01"
      }
    ]
  }
  ```
- **Phase 1: Validation:**
  The entire batch fails with HTTP `422 INVALID_ROWS` if any row violates validation rules. Return all errors inside `error.errors`:
  ```json
  {
    "error": {
      "code": "INVALID_ROWS",
      "message": "One or more gateway rows failed validation",
      "errors": [
        { "gateway_txn_id": "T-88121", "code": "DUPLICATE_TXN" }
      ]
    }
  }
  ```
  Validation error codes:
  1. `DUPLICATE_TXN`: Added for every row whose `gateway_txn_id` appears more than once in the request payload.
  2. `ROW_OUTSIDE_MONTH`: `attempted_on` (YYYY-MM-DD) does not belong to `month` (YYYY-MM).
  3. `CURRENCY_MISMATCH`: The row's `agreement_id` exists in store, but the agreement plan's currency does NOT match the row's `currency`. (Note: Skip this check if agreement does not exist).

- **Phase 2: Expected Invoices Generation:**
  - An expected invoice is any invoice, from any agreement stored in the system, whose computed `due_date` falls in `month`.

- **Phase 3: Matching Logic (Deterministic & Order-Independent):**
  - **Only `SETTLED` rows participate in matching.**
  - For each `SETTLED` row:
    - If `agreement_id` does not exist in store -> verdict: `MISSING_FROM_LEDGER`.
    - If agreement exists: find candidate expected invoices for that agreement where:
      $$|	ext{invoice.total} - 	ext{row.amount}| \le 1 	ext{ minor unit}$$
    - If no candidates -> verdict: `MISSING_FROM_LEDGER`.
    - If multiple candidates -> tie-breaker: select candidate with the **earliest `due_date`**.
    - Link the row to this candidate invoice `(agreement_id, invoice_no)`. Multiple rows can link to the same candidate invoice.

- **Phase 4: Assigning Verdicts:**
  | Verdict | Condition |
  |---|---|
  | `DECLINED` | Row `status == "DECLINED"`. `invoice` set to `null`. Takes no part in matching. |
  | `MISSING_FROM_LEDGER` | Unknown agreement, or agreement has no candidate invoice within $\pm 1$ minor unit. |
  | `MATCHED` | Exactly **one** settled row is linked to this invoice, AND `row.attempted_on == invoice.due_date`. |
  | `DUE_DAY_DRIFT` | Exactly **one** settled row is linked to this invoice, AND `row.attempted_on != invoice.due_date`. |
  | `DOUBLE_CHARGE_RISK` | **Two or more** settled rows are linked to the same candidate invoice. Every linked row receives this verdict. |

- **Phase 5: Output Construction:**
  - `summary`: Counts of each verdict (`MATCHED`, `DUE_DAY_DRIFT`, `DOUBLE_CHARGE_RISK`, `MISSING_FROM_LEDGER`, `DECLINED`). All keys must be present (including 0s).
  - `rows`: Returned in exact original request order. `invoice` is `{ agreement_id, invoice_no }` or `null`.
  - `unmatched_invoices`: Every expected invoice in `month` that has **zero settled rows** linked to it (invoices whose only rows were DECLINED belong here).
    - **Sorted strictly by:** `due_date` ASC, then `agreement_id` ASC, then `invoice_no` ASC.
- **Persistence:** Save the run with a generated `id` so it can be retrieved via `GET /reconciliation/runs/:id`.

---

## 6. Dockerfile Specifications
A complete multi-stage `Dockerfile`:
```dockerfile
# Stage 1: Build & Dependencies
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Stage 2: Test Stage (Must pass: docker build --target test .)
FROM builder AS test
COPY tests ./tests
RUN npm run test

# Stage 3: Production Runner (Offline runtime)
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8080
USER node
CMD ["node", "dist/index.js"]
```

---

## 7. Deliverables & Documentation Required
1. **Source Code:** Complete TypeScript code without any placeholder comments (`// TODO`).
2. **Automated Tests:** Comprehensive Vitest / Jest test suite covering:
   - Phone cleaning, dial-code permutations, national vs international mismatch.
   - Concurrent `POST /members` race condition tests (`PHONE_TAKEN`).
   - Agreement due dates clamping for leap years (29 Feb), 30-day months, 31-day months.
   - Half-up rounding worked examples from GymNation brief (SA: 29900/11/30, AE: 24900/15/31 with 9900 joining fee).
   - Reconciliation validations (`DUPLICATE_TXN`, `ROW_OUTSIDE_MONTH`, `CURRENCY_MISMATCH`).
   - Reconciliation matching (`MATCHED`, `DUE_DAY_DRIFT`, `DOUBLE_CHARGE_RISK`, `MISSING_FROM_LEDGER`, `DECLINED`, `unmatched_invoices` sorting).
3. **`NOTES.md`:**
   - How to build and run container.
   - What architectural decisions or trade-offs were made.
   - Explicit list of assumptions (one line per assumption).
4. **`PROMPTS.md`:**
   - Log of prompts used and rationale.
5. **Postman Collection:** `gymnation-api.postman_collection.json` with sample requests for every endpoint and error case.

---
**Instruction to LLM:** Please output the complete, production-ready codebase file-by-file with clean typing, error handling, and high test coverage.

---

## 8. Operational Guide: Database, Startup Data, Tests, and Hidden Evaluation
This section is authoritative wherever earlier wording leaves implementation choices open.

### 8.1 Do we need a database?
No external database is required or expected. The brief explicitly allows in-memory state or embedded storage and says each run starts empty. Prefer simple in-memory repositories (`Map`) for this small evaluation service unless there is a clear reason to use SQLite. Do not add PostgreSQL, Supabase, a cloud database, migrations, or a network dependency. Keep repository interfaces so storage can be replaced later without changing domain rules.

A suggested in-memory state:
- `membersById: Map<MemberId, Member>`
- `memberIdByNormalizedPhone: Map<E164Phone, MemberId>`
- `plansById: Map<PlanId, Plan>`
- `agreementsById: Map<AgreementId, Agreement>`
- `reconciliationRunsById: Map<RunId, ReconciliationRun>`

These maps are the database for one process. They are intentionally empty at startup. They disappear when the container stops or restarts; this matches the evaluation contract.

### 8.2 How does the evaluator create data if there is no seed?
The evaluator should create all required records through the public API in each test scenario, in dependency order:
1. `POST /members`
2. `POST /plans`
3. `POST /agreements` using the IDs returned above
4. Request invoices or submit reconciliation rows

Never depend on pre-seeded production/demo data, fixed IDs, or test execution order. The application itself must not seed example entities on startup. The provided task says plans are created through the API and must not be seeded. Reconciliation runs are stored only so their response can be read back; they must not mutate members, plans, or agreements.

### 8.3 Testing layers and where test cases come from
The evaluator's unseen requests are not available to the candidate. Do not guess or claim to know their exact cases. Derive your own tests from every sentence in the published contract and systematically cover:
- **Happy paths:** each endpoint's valid request and exact response shape/status.
- **Validation boundaries:** required/missing fields, wrong JSON types, malformed dates, unsupported country/currency/status, integer vs decimal, lower/upper limits, and invalid ranges.
- **Equivalence classes:** all three phone spellings and allowed formatting characters; each country; leap/non-leap years; month lengths; each reconciliation verdict.
- **Boundary values:** due_day 1 and 31; start date exactly on a due date; invoice query inclusive endpoints; 366-day range accepted and 367-day range rejected; amount difference exactly 1 vs 2 minor units.
- **Interactions:** duplicate phone in alternate spellings, mismatched member/plan countries, multiple agreements, multiple matching invoices, declined-only invoice, repeated gateway transactions, same-invoice duplicate settlements, and stable sorting.
- **Concurrency:** send two simultaneous creates for equivalent normalized phones; assert one 201 and one 409, and that the conflict identifies the stored winner. Also test duplicate plan IDs concurrently if the implementation has an async boundary.

Use three complementary test styles:
1. **Unit tests** for pure domain functions (phone normalization, date schedule, integer rounding, matching).
2. **HTTP integration tests** against a real Fastify instance listening on an ephemeral local port, exercising request parsing, validation, status codes, and response JSON. These tests can use Fastify's `inject()` API.
3. **Container contract smoke tests** that build and run the image, poll `GET /health`, then create records through the API and exercise one end-to-end invoice/reconciliation flow.

The code author's tests are not the hidden evaluator. Passing local tests is evidence, not proof; the external scoring service is the final authority.

### 8.4 Exact money math: do not use floating point
Do not implement the earlier illustrative `Math.floor(value + 0.5)` formula with JavaScript `number` for money. IEEE-754 floating point can produce incorrect boundary rounding. Use integer arithmetic with `BigInt` and rational rates:
- Prorated amount: calculate `monthly * days / cycleDays` with integer numerator and denominator, then round half up using quotient/remainder. For non-negative values: `q = numerator / denominator`, `r = numerator % denominator`, result is `q + (2*r >= denominator ? 1 : 0)`.
- VAT rates: AE = 5/100, SA = 15/100, BH = 10/100. Compute `net * rateNumerator / rateDenominator` using the same integer half-up operation.
- Validate values fit the API's accepted integer range; convert back to JSON numbers only after safe-range checks. Do not silently overflow `Number.MAX_SAFE_INTEGER`.
- The example calculations in the original task are golden tests: SA first invoice 10963 net, 1644 VAT, 12607 total; AE first invoice 21948 net, 1097 VAT, 23045 total.

### 8.5 Deterministic tests and fresh state
- Each test must get a fresh application instance/repository, or explicitly reset its in-memory state. Tests must not leak records across cases.
- Use fixed clocks only if a feature actually reads current time. The specified invoice schedule is based on request dates and must not depend on system time.
- Use stable IDs in tests and generated IDs in normal API use. Never assert a particular UUID value.
- Do not make runtime HTTP calls to external services. Unit/integration tests should be self-contained and deterministic.

### 8.6 Postman: collection as a manual setup and verification flow
Create `gymnation-api.postman_collection.json` as a **manual API client**, not as a source of production seed data. Include folders or requests in this order: Health; Create Member; Create Plan; Create Agreement; List Invoices; Create Reconciliation Run; Read Reconciliation Run; Validation/Error examples. Use `baseUrl` (default `http://localhost:8080`) and collection variables for `memberId`, `planId`, `agreementId`, and `runId`. In Postman Tests scripts, capture returned IDs into variables so later requests can use them. Add a README section explaining how to import the collection, start the container, run requests in order, and reset state by restarting the container. The collection must not claim to execute the hidden test suite.

### 8.7 Startup, smoke test, and submission runbook
Document and verify this exact sequence locally:
1. `npm ci`
2. `npm test` and `npm run build`
3. `docker build --target test -t gymnation-api:test .`
4. `docker build -t gymnation-api:local .`
5. `docker run --rm -p 8080:8080 gymnation-api:local`
6. In another terminal, call `GET http://localhost:8080/health`; then use the Postman collection to create a member, plan, agreement, retrieve invoices, and create/read a reconciliation run.
7. Recreate the container and verify it starts empty; this confirms there is no accidental persistence or startup seed.
8. Check the final Git repository: root-level `Dockerfile`, `NOTES.md`, `PROMPTS.md`, and Postman JSON are present; all intended files are committed to the `main` branch; repository size is below 200 MB; no secrets or `.env` files are committed.
9. Record the short walkthrough explaining architecture, one critical edge case, tests, and how AI was used. Be ready to change a feature live, so understand the code rather than only presenting generated output.

### 8.8 Docker target correctness
The Docker build must install dependencies during image build only; the running container must not need network access. Keep a lockfile and use `npm ci` for reproducibility. Ensure the `test` target includes dev dependencies and tests and actually runs the test command during `docker build --target test .`. Ensure the default final image starts the server and does not run tests on startup. Test both commands exactly as the employer will invoke them.

---

## 9. Engineering Review Checklist Before Submission
- [ ] Every endpoint, status code, error code, and JSON field matches the supplied brief exactly.
- [ ] No startup seed; evaluator setup happens through API requests.
- [ ] No external database or network access is required at runtime.
- [ ] Money uses safe integer/BigInt rational arithmetic and rounds only at the two specified points.
- [ ] Date calculations use calendar dates, not local timezone-sensitive timestamps.
- [ ] Candidate selection and reconciliation output are deterministic and independent of input row order, while response rows preserve input order.
- [ ] Duplicate writes remain correct under concurrent requests.
- [ ] Both Docker commands pass, and `/health` is available promptly on `0.0.0.0:8080`.
- [ ] Local tests cover the contract systematically; do not claim they reproduce the unseen grader.
- [ ] `NOTES.md`, `PROMPTS.md`, and the Postman collection are accurate and useful.
