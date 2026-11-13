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

- Part 2 (plans, agreements, invoices) and Part 3 (reconciliation) are not built yet. They are the next milestones.
- The Postman collection is not written yet. It will be added once every endpoint exists.
- There is no persistence, authentication, rate limiting or OpenAPI document. The brief does not ask for them.

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
