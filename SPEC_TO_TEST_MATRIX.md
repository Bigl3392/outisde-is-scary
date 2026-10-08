# SPEC_TO_TEST_MATRIX — Field Receipt

Dark Factory Stage 1 floor (scaled): no code without every hard requirement mapped to a test, a human-only decision, or an explicit non-testable note. Unmapped hard = `ACCEPTANCE_GAP` = blocks build.

Status: DRAFT · Canon: none (public reference implementation; no INOS / TimeLine canon) · Layer: IN-800 adjacent

## A. Challenge rules (source: dev.to/challenges/hacktoberfest-week1-2026-10-05)

| ID | Requirement | Method | Evaluator | Test / owner | Status |
|---|---|---|---|---|---|
| C-01 | New project AND new repo created within Oct 5 09:00 PDT – Oct 11 23:59 PDT | Human-only | LDR | LDR creates repo; first commit date checked | OPEN (LDR) |
| C-02 | Open-source AI at core (Gemma) | Executable | CI/manual | M-02 model loads + extracts on device | OPEN |
| C-03 | Public code repository | Human-only | LDR | Repo public before submit | OPEN (LDR) |
| C-04 | Demo (deployed or video) | Human-only | LDR | Cloudflare Pages URL + short video | OPEN (LDR) |
| C-05 | Explain why open innovation matters | Doc | LDR/GEM | Write-up section | OPEN |
| C-06 | Submission post uses template, tags `devchallenge`, `hf26challenge` | Human-only | LDR | Post checked before publish | OPEN (LDR) |
| C-07 | Commits after deadline noted in README | Doc | ARC | README "Post-deadline commits" section exists | DONE-IN-README |
| C-08 | Deadline Oct 11 23:59 PDT (= Oct 12 01:59 CDT) | Human-only | LDR | Submit by Oct 11 evening CDT | OPEN (LDR) |
| C-09 | One submission only | Human-only | LDR | — | OPEN (LDR) |
| C-10 | Writing quality weighted most | Non-testable | LDR/GEM | Write-up drafted Sun | OPEN |

## B. Functional requirements

| ID | Requirement | Method | Test ID | Status |
|---|---|---|---|---|
| FR-AT-001 | Raw note saved verbatim BEFORE any inference | Unit | `receipt.test: raw note retained pre-inference` | OPEN |
| FR-AT-002 | AI output never raises verification above SELF_ATTESTED | Unit | `receipt.test: AI cannot raise verification` | OPEN |
| FR-AT-003 | Invalid / non-JSON / schema-failing model output → status FAILED, raw output retained, claim intact | Unit | `receipt.test: failed output retains raw` | OPEN |
| FR-AT-004 | Original event time (claimed) separate from processing time | Unit | `receipt.test: event vs processing time` | OPEN |
| FR-AT-005 | Human confirm is the only path to HUMAN_CONFIRMED; idempotent | Unit | `receipt.test: human confirm` | OPEN |
| FR-AT-006 | Receipt hash deterministic and tamper-evident | Unit | `receipt.test: hash` | OPEN |
| FR-AT-007 | `missing` always lists `independent_corroboration` | Unit | `receipt.test: missing list` | OPEN |
| FR-AT-008 | Receipts persist locally (IndexedDB) | Manual | M-04 reload keeps receipts | OPEN |

## C. Device / model (manual on Galaxy S26, Chrome)

| ID | Requirement | Evidence to retain | Status |
|---|---|---|---|
| M-01 | Device check reports WebGPU, shader-f16, secure context | Screenshot / metrics JSON | OPEN |
| M-02 | Gemma 3 1B loads on S26 and returns schema-valid JSON for the default note | Metrics JSON (load s, tok/s) | OPEN |
| M-03 | Load time and tok/s recorded BEFORE judging acceptable | Metrics JSON persisted | OPEN |
| M-04 | After first load, app works with network off | Airplane-mode test | OPEN (later) |

## D. Mock Data Doctrine

| ID | Requirement | Method | Status |
|---|---|---|---|
| D-01 | README carries synthetic-data notice; fixtures have `source_type: "SYNTHETIC"` | Doc + Unit (`fixtures valid & synthetic`) | OPEN |
| D-02 | No secrets, keys, tokens in repo | grep gate | OPEN |
| D-03 | No INOS / TimeLine / Time Token / Trust Weight machinery | grep gate | OPEN |
| D-04 | No real Dani / CNGI / GGP material; demo org Ember & Oak Hospitality Group only | Review | OPEN |

## E. Dark Factory floor (what applies at this scale)

| Floor item | Applied as |
|---|---|
| Spec coverage before coding | This file |
| Identity preflight | Repo-local git identity set and checked before first commit |
| Raw evidence on failed assertions | Metrics JSON + raw model output retained in receipts |
| Human decision membrane | LDR creates repo, pushes, publishes, submits; no autonomous submit |
| Deterministic state owner | `receipt.ts` owns state/time/hash; Gemma only extracts |
| Regression drills | Not applicable (Forge/Training Bay); not executed |

## Ambiguities (unresolved, flagged)

- A-01: "Created within window" — repo creation timestamp on GitHub is the evidence; LDR must create it Oct 8–11.
- A-02: "Offline" claim — true only after first weight download; README states this.
