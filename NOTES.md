# Notes

## How to run

```bash
docker build --target test -t gymnation-api:test .   # typecheck + full test suite, fails the build on any failure
docker build -t gymnation-api .
docker run --rm -p 8080:8080 gymnation-api
curl http://localhost:8080/health                    # {"status":"ok"}
```

Without Docker (Node 20 or newer): `npm ci && npm test && npm run build && npm start`.

State is in memory and starts empty on every start. There is no seed data.

## What was skipped

- There is no persistence, authentication, rate limiting or OpenAPI document. The brief does not ask for them.

## Design decisions and trade-offs

- **Pure domain, thin HTTP.** Phones, dates, money, invoices and reconciliation live in `src/domain/` with no I/O, so every rule is unit-tested directly. Routes only validate, look things up and call the domain.
- **In-memory `Map` store.** The brief wants an empty start and no network. Uniqueness checks are synchronous (no `await` between check and insert), so concurrent creates cannot both win.
- **Invoices are computed, never stored.** Each request computes only the months inside its window, so `invoice_no` comes from arithmetic and stays fast for any date.
- **No floats for money and no `Date` for calendars.** BigInt half-up rounding and day-number arithmetic give exact, time-zone-free results.
- **Reconciliation links each row on its own.** A settled row picks its invoice without looking at other rows, then verdicts are counted per invoice. That makes the result independent of row order by construction.
- **Trade-off:** no persistence or OpenAPI document, to keep the code small for the live change.

## Assumptions

One line per decision where the brief is silent.

- The image uses Node 22 LTS. The brief says Node 20+, and Node 20 reached end of life in April 2026.
- An international spelling must omit the trunk 0 after the dial code, so `+9710501234567` returns `INVALID_PHONE`.
- Only spaces, `-`, `(` and `)` are removed from a phone. Any other character (tab, dot, slash, letter) returns `INVALID_PHONE`.
- A national-form phone on `POST /members` is read in the member's own country, so a BH member with `0501234567` gets `INVALID_PHONE`.
- An international phone on `POST /members` may belong to any of the 3 countries, whatever the member's country.
- A phone that is missing or not a JSON string returns `VALIDATION`. A string that breaks the phone rules returns `INVALID_PHONE`.
- On lookup, a phone that fits no country's format returns `INVALID_PHONE`, even without `country`. `PHONE_NEEDS_COUNTRY` is only for a valid national-form number.
- On lookup, a national number that is not a mobile in the given `country` returns `INVALID_PHONE`.
- Country codes are case-sensitive uppercase, so `"ae"` returns `VALIDATION`.
- Name length is counted after the trim, in JavaScript string length (UTF-16 code units).
- A query parameter given twice (`?phone=1&phone=2`) returns `VALIDATION`.
- A body that is not JSON (wrong content type, empty, unparseable or `null`) returns `422 VALIDATION`.
- Unknown extra JSON fields are ignored and never echoed back.
- When a request has several problems, schema `VALIDATION` is reported first, then lookups (`UNKNOWN_*` / `NOT_FOUND`), then business rules.
- A plan `id` must be a non-empty string. It is stored exactly as sent (no trim, case-sensitive).
- A plan is rejected with `VALIDATION` when `monthly + joining_fee` plus its VAT would pass `Number.MAX_SAFE_INTEGER`, because that is the largest net any invoice can have.
- `POST /agreements` checks `start_date` before the lookups, so a bad date with an unknown member returns `VALIDATION`.
- `GET /agreements/:id/invoices` checks `from`/`to` syntax first, then the agreement id (`404`), then `INVALID_RANGE`.
- The range limit counts days from `from` to `to`: 366 days is accepted, 367 is `INVALID_RANGE`.
- Any 4-digit year is accepted in dates, using the proleptic Gregorian calendar.
- A reconciliation `month` must be strict `YYYY-MM` with a month from 01 to 12, otherwise `VALIDATION`.
- A row's `currency` may be any string. An unknown code such as `USD` is not `VALIDATION`: it gives `CURRENCY_MISMATCH` when the agreement exists and is ignored when it does not.
- A row `amount` must be an integer from 1 to `Number.MAX_SAFE_INTEGER`, otherwise `VALIDATION`.
- A row with a bad shape or a bad `attempted_on` date fails the whole request with `VALIDATION`, before any `INVALID_ROWS` check. Only the 3 brief codes produce `INVALID_ROWS`.
- When a row has several problems, each is listed, in the order `DUPLICATE_TXN`, `ROW_OUTSIDE_MONTH`, `CURRENCY_MISMATCH`.
- `DECLINED` rows are validated like settled rows, so they can produce `ROW_OUTSIDE_MONTH` and `CURRENCY_MISMATCH`.
- `gateway_txn_id` duplicates are compared exactly (case-sensitive).
- A response row has `gateway_txn_id`, `verdict` and `invoice`. An `unmatched_invoices` item has `agreement_id`, `invoice_no`, `due_date`, `total` and `currency`, as in the brief's example.
- The `agreement_id` sort in `unmatched_invoices` compares plain code units, not locale order.
- A run uses the agreements that exist when it is created and is stored as an immutable snapshot. Agreements added later do not change a stored run.
- An `INVALID_ROWS` or `VALIDATION` request stores no run.
