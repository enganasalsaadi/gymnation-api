# GymNation Membership & Reconciliation API: Project Rules

These rules apply to every session and every agent working in this repo. Hidden automated graders replay several hundred unseen requests against the container, and each Part (1, 2, 3) is scored separately. **Exact status codes, error codes, field names and integer results matter more than anything else.**

- Full spec: [GymNation_Prompt.md](GymNation_Prompt.md). If this file and the prompt disagree, the original brief wins, then this file, then the prompt.
- Original brief (source of truth): https://forms.gymnation.com/f/hAh5gfoF8s7MZgJEE-c6f8KE?src=nawras&lang=en

---

## 0. Hiring-process facts that shape the code

1. The grader builds the image and replays requests. If the container fails to build or start, there is only **one 48-hour retry**. Both `docker build --target test .` and `docker build -t app . && docker run -p 8080:8080 app` must pass before any push.
2. Only the `main` branch is checked. The repo must stay under 200 MB. No secrets and no `.env` files.
3. A follow-up **45-minute live interview** asks the candidate to add a feature on their own laptop, after which the graders re-run their checks. Keep the code **small, readable and easy to change**: pure functions, one obvious place per rule, no clever abstractions. A short file beats a deep folder tree.
4. Required root files: `Dockerfile`, `NOTES.md` (how to run, what was skipped, **one line per assumption**), `PROMPTS.md` (AI conversations log), `README.md`, and the Postman collection.
5. Heavy AI use is expected. Append each meaningful AI session to `PROMPTS.md`.

---

## 1. Runtime contract (never break)

- Listen on `0.0.0.0:8080`. `GET /health` returns `200 {"status":"ok"}` well within 60 s.
- No network at runtime. All dependencies are installed at image build time. State lives in in-memory `Map`s and starts **empty** on every start. **No startup seed data** (no demo plans, members or agreements).
- JSON in and out, using **snake_case** field names exactly as the brief shows.
- Dates are strict `YYYY-MM-DD` with a real calendar check (`2026-02-29` is invalid, `2028-02-29` is valid). Months are strict `YYYY-MM`.
- Money is **integer minor units only**. Every invoice carries its ISO `currency`.
- Generated IDs are UUID v4. Caller IDs (the plan `id`) are stored and returned byte-for-byte.

## 2. Error envelope (never break)

```json
{ "error": { "code": "<CODE>", "message": "<text>" } }
```

| Situation | HTTP | code |
|---|---|---|
| Malformed input: missing field, wrong JSON type, bad date or month syntax, out-of-range integer, unknown enum value, **unparseable JSON body** | 422 | `VALIDATION` |
| Unknown id in a URL path (agreement, reconciliation run) and **unknown routes** | 404 | `NOT_FOUND` |
| Any other unexpected error | 500 | `INTERNAL` (never leak stack traces) |

**Fastify traps. Each must be handled explicitly:**
- Fastify answers schema failures and bad JSON with **400**. Map both to **422 `VALIDATION`** in a custom error handler.
- Ajv in Fastify **coerces types by default** (`"100"` becomes `100`). Disable coercion with `ajv.customOptions.coerceTypes = false` for bodies so that a string `"29900"` is a 422.
- Map the default 404 handler to the envelope.
- Extra `error` fields are allowed only where the brief specifies them: `existing_member_id` and `errors`.

**Check order inside one request:** schema `VALIDATION` first, then lookups (`UNKNOWN_*` / `NOT_FOUND`), then business rules.

---

## 3. Business rules: Part 1, Members and phones

| Country | Dial | Currency | Minor unit | VAT | National mobile | E.164 |
|---|---|---|---|---|---|---|
| AE | 971 | AED | 100 | 5/100 | `^05\d{8}$` | `+9715` + 8 digits (13 chars) |
| SA | 966 | SAR | 100 | 15/100 | `^05\d{8}$` | `+9665` + 8 digits (13 chars) |
| BH | 973 | BHD | 1000 | 10/100 | `^3\d{7}$` (no trunk 0) | `+9733` + 7 digits (12 chars) |

Phone normalization pipeline, in this order:
1. Remove spaces, `-`, `(`, `)`.
2. Anything left except digits and **one leading `+`** returns `422 INVALID_PHONE` (`+` in the middle, two `+`, letters, dots, slashes).
3. A leading `00` returns `422 INVALID_PHONE`.
4. The accepted spellings are:
   - **A:** `+` + dial + mobile **without** the trunk 0 (`+971501234567`, `+97331234567`).
   - **B:** dial + mobile without the `+` (`971501234567`).
   - **C:** national form (`0501234567`, `31234567`).
5. A landline, a wrong length or an unknown dial code returns `422 INVALID_PHONE`.
6. Store and return **E.164 only**: `+<dial><mobile without trunk 0>`.

`POST /members`: `name` is trimmed and must be 1 to 120 characters after the trim. `country` is one of AE, SA or BH. A national-form phone is read **in the member's country**. An international phone may be from **any of the 3 countries**, regardless of the member's country (for example an expat in AE with an SA SIM). Success returns `201`.

`GET /members/lookup?phone=&country=`:
- A national-form phone with no `country` returns `422 PHONE_NEEDS_COUNTRY`.
- An international phone whose `country` disagrees with the dial code returns `422 PHONE_COUNTRY_MISMATCH`.
- No member found returns `404 NOT_FOUND`. A match returns `200` with the member object.

**Uniqueness:** checked on the normalized E.164 number. A duplicate returns `409 PHONE_TAKEN` with `error.existing_member_id` set to the stored winner's id. This must hold **under concurrent requests using different spellings**: exactly one 201 and one 409 that names the winner.

## 4. Business rules: Part 2, Plans, agreements and invoices

- `POST /plans`: `monthly` is an integer > 0 and `joining_fee` is an integer >= 0, both pre-VAT minor units. `currency` comes from `country`. A duplicate `id` returns `409 PLAN_EXISTS`, even under concurrent requests. Success returns `201`.
- `POST /agreements`: `due_day` is an integer from 1 to 31. Errors are `422 UNKNOWN_MEMBER`, then `422 UNKNOWN_PLAN`, then `422 PLAN_COUNTRY_MISMATCH` (member country != plan country). A member may hold **several** agreements. Agreements **never end**. Success returns `201`.
- `GET /agreements/:id/invoices?from=&to=`: an unknown id returns 404. Missing or malformed `from`/`to` returns `VALIDATION`. `to < from`, or `to - from > 366` days, returns `422 INVALID_RANGE` (exactly 366 is OK, 367 is rejected). The filter is on `due_date`, inclusive at both ends. Invoices are computed on every request and **never stored**.

**Invoice schedule:**
- Due date in month (y, m) = `min(due_day, days_in_month(y, m))`. **The anchor stays at `due_day`.** A 31 that clamps to 28 Feb returns to 31 Mar.
- `invoice_no` counts from the start of the whole schedule. It **never resets** for the query window.
- Invoice 1 has `kind: "FIRST"` and `due_date = start_date`. `N` is the first due date **strictly after** start. `P` is the due date one month before N, computed from the anchor with clamping. `D = N - start`, `C = N - P`, and `proration = {days: D, cycle_days: C}`. If start is itself a due date, then D = C and the full monthly price applies.
- Invoices 2 and later have `kind: "MONTHLY"`, `net = monthly` and `proration: null`. Invoice 2 is due on N.

**Money math. Integers or BigInt only, with no floats anywhere:**
```
round_half_up(num, den) = q + (2*r >= den ? 1 : 0)   where q = num / den, r = num % den (non-negative)
prorated = round_half_up(monthly * D, C)
net      = prorated + joining_fee          // the joining fee is in the VAT base (FIRST invoice only)
vat      = round_half_up(net * rate_num, rate_den)
total    = net + vat
```
Round **exactly twice** per FIRST invoice and once (VAT) per MONTHLY invoice. Never round in major units. Reject inputs whose totals would exceed `Number.MAX_SAFE_INTEGER`.

**Golden tests. Must always pass:**
- SA 29900, fee 0, start 2026-09-20, due_day 1 → D=11, C=30, net **10963**, vat **1644**, total **12607**
- AE 24900, fee 9900, start 2026-09-05, due_day 20 → D=15, C=31, net **21948**, vat **1097**, total **23045**, invoice 2 due 2026-09-20

**Dates:** use pure calendar arithmetic, for example a day-number from (y, m, d) or UTC-only math. **Never** use `new Date("YYYY-MM-DD")` in local time, and never read the system clock for business logic.

## 5. Business rules: Part 3, Reconciliation

`POST /reconciliation/runs` returns `201` with the full run. `GET /reconciliation/runs/:id` returns `200` with the **identical** body, or 404.

1. **Schema validation** (missing field, non-integer `amount`, `status` not in `SETTLED`/`DECLINED`, bad dates) returns `422 VALIDATION`.
2. **Row validation** returns `422 INVALID_ROWS`, and the **whole batch fails**. `error.errors` is a list of `{gateway_txn_id, code}` covering **every** problem, in request-row order:
   - `DUPLICATE_TXN`: added for **every** row whose id appears more than once, not only the second one.
   - `ROW_OUTSIDE_MONTH`: `attempted_on` is not in `month`.
   - `CURRENCY_MISMATCH`: the agreement exists and its plan currency differs from the row's `currency`. **Skip this check when the agreement is unknown.**
3. **Expected invoices:** every invoice of **every stored agreement** whose `due_date` falls in `month`. One agreement can have 2 in a month: FIRST plus invoice 2.
4. **Matching** uses `SETTLED` rows only. A row is a candidate for an expected invoice of **the same agreement** when `|total - amount| <= 1`. Ties go to the **earliest `due_date`**. An unknown agreement or no candidate gives `MISSING_FROM_LEDGER`. Several rows can link to one invoice.
5. **Verdicts:**
   - `DECLINED`: `invoice: null`, never linked.
   - Exactly 1 settled row on the invoice: `MATCHED` if `attempted_on == due_date`, otherwise `DUE_DAY_DRIFT`.
   - 2 or more settled rows on the same invoice: **all** of them get `DOUBLE_CHARGE_RISK`.
6. **Output:**
   - `summary` always lists all 5 keys, including zeros.
   - `rows` are in **original request order**, with `invoice: {agreement_id, invoice_no}` or `null`.
   - `unmatched_invoices` lists expected invoices with **zero settled rows**. Declined-only invoices are included. Sort by `due_date`, then `agreement_id`, then `invoice_no`, all ascending.
   - The result must be **independent of row order**: shuffle the rows and every verdict stays the same.
7. A run is a stored snapshot. It must **never mutate** members, plans or agreements.

---

## 6. Never-forget edge cases (each needs a test)

- [ ] Same phone in spellings A, B and C, sent concurrently with `Promise.all`, returns one 201 and one 409 with the winner's id.
- [ ] An AE member registers an SA number (`+9665…`) and gets 201. The stored phone is `+966…`.
- [ ] `00971501234567`, `+97105…` (trunk 0 after the dial code), `+9715012345` (short), `9715012345678` (long), `050-123.4567`, `05O1234567` (letter O) and `+` in the middle all return `INVALID_PHONE`.
- [ ] A BH member sending `0501234567` returns `INVALID_PHONE`, because a national number is read in the member's own country.
- [ ] Lookup with `31234567` and no country returns `PHONE_NEEDS_COUNTRY`. `+966…` with `country=AE` returns `PHONE_COUNTRY_MISMATCH`.
- [ ] Name `"   "` returns `VALIDATION`. A name of 120 characters after the trim is OK, and 121 is rejected.
- [ ] `due_day` values 0, 32, `1.5` and `"1"` all return `VALIDATION`.
- [ ] `due_day` 31: 31 Jan, 28 Feb 2027, 29 Feb 2028, 31 Mar, 30 Apr.
- [ ] A start date that is itself a clamped due date (2027-02-28 with due_day 31) charges the full price.
- [ ] The invoice window starts mid-history, and `invoice_no` continues from the agreement's start.
- [ ] A window entirely before `start_date` returns `[]` with 200.
- [ ] A 366-day range returns 200 and a 367-day range returns `INVALID_RANGE`. `to == from` is OK.
- [ ] BHD uses 1000 fils, so check rounding on 3-decimal currency values.
- [ ] Reconciliation: amount diff 1 matches and diff 2 does not. A declined-only invoice appears in `unmatched_invoices`. The same txn id 3 times produces 3 `DUPLICATE_TXN` errors. An empty `rows` list returns 201 with an all-zero summary.
- [ ] Malformed JSON body returns 422 `VALIDATION`, not 400. An unknown route returns the 404 envelope.
- [ ] Every container restart starts empty.

---

## 7. Engineering rules

- **Stack:** Node 20 LTS, TypeScript `strict`, Fastify, Vitest, and `Map` repositories. Keep `package-lock.json` committed and use `npm ci`.
- **Concurrency:** Node is single-threaded, so a check-and-insert is atomic **only if there is no `await` between the check and the `Map.set`**. Keep uniqueness checks synchronous. If an async step is ever added, put it behind a per-key mutex.
- **Domain logic is pure:** money, dates, phones and matching do no I/O and use no framework, so they can be unit-tested directly.
- **Tests:** unit tests for the pure domain, HTTP tests through `app.inject()` with a **fresh app per test**, and never assert a specific UUID.
- Never use `// TODO` placeholders. Never use floats for money. Never seed data.
- **Before every push**, run `npm test`, `npm run build`, `docker build --target test .` and `docker build -t app .`, then `docker run`, then `curl /health`.
- Commit messages follow Conventional Commits.
- **Workflow agreed with the candidate:** build one Part at a time and stop for review after each one. Commit to `main` after each milestone once its tests pass. **Never push**: the candidate pushes.
- **After each milestone, update `README.md`** (status checklist, how to run, how to verify) so the reviewer can check the repo at any moment. Also update `NOTES.md` (assumptions) and `PROMPTS.md`.

## 8. Skills to use

| When | Skill |
|---|---|
| Fastify routes, schemas, error handler, `inject` tests | `fastify-best-practices` (mcollina) |
| Writing tests first, red-green-refactor | `tdd` (mattpocock) |
| Vitest config and APIs | `vitest` (antfu) |
| Dockerfile with `test` target, offline runtime | written by hand (the `multi-stage-dockerfile` skill failed to install) |
| Module boundaries that keep the code easy to change in the live interview | `codebase-design` |
| Review before push | `code-review` / `code-reviewer`, `security-review` |
| NOTES.md assumptions and decisions | `documentation-and-adrs` |
| Commit messages | `caveman-commit` |
| Concurrency or load smoke test (optional) | `k6` |

## 9. Open assumptions (copy to NOTES.md, one line each)

- International spellings must omit the trunk 0 after the dial code (`+97105…` is invalid). Confirmed by the candidate.
- A national-form phone on create must match the member's own country's mobile pattern, otherwise `INVALID_PHONE`.
- On lookup, a national-form phone that does not match the given `country`'s pattern returns `INVALID_PHONE`.
- A field that is missing or not a string returns `VALIDATION`. A string that fails the phone rules returns `INVALID_PHONE`.
- Country codes are case-sensitive uppercase, so `"sa"` returns `VALIDATION`.
- A row with a bad shape in a reconciliation batch returns `VALIDATION`. Only the 3 brief codes produce `INVALID_ROWS`.
- When a row has several errors, each error is listed, in the order DUPLICATE_TXN, ROW_OUTSIDE_MONTH, CURRENCY_MISMATCH.
- `unmatched_invoices` items carry `agreement_id`, `invoice_no`, `due_date`, `currency` and `total`.
- A reconciliation run uses the agreements that exist at the moment the run is created, and is stored as an immutable snapshot.
- Unknown extra JSON fields are ignored.
