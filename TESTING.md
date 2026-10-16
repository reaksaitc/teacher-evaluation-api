# Backend testing and evaluation guide

Use this guide to evaluate every backend feature with repeatable steps and recorded evidence. It describes this repository's current tests and contracts; it is not a claim of certification or complete frontend acceptance.

For the latest `improve.txt` A–S contracts and coverage, see [backend alignment contracts](docs/BACKEND_ALIGNMENT_CONTRACTS.md). Counts and database alignment statements elsewhere in this guide describe the earlier delivery.

### Isolated alignment regression database

If the shared local test database has migrations from another checkout, use a separate database instead of resetting it. The existing `.env.test.local` must still reference the guarded local `teacher_evaluation_test` database. From this repository:

```powershell
npm.cmd run test:alignment:prepare
$env:TEST_DATABASE_SUFFIX = 'alignment'
npm.cmd run test:e2e:migrate
npm.cmd run test:e2e:seed
npm.cmd test -- --runInBand
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run lint
Remove-Item Env:TEST_DATABASE_SUFFIX
```

Preparation creates only `teacher_evaluation_test_alignment` if absent, without resetting it or resolving migration failures. The suffix runner validates the local base configuration before selecting `teacher_evaluation_test_<suffix>`. Migration, seeding, and API tests then use that database. Seeds restore synthetic test accounts; coordinate with anyone sharing the selected test database. First-administrator tests additionally create and remove their own exact disposable database; the test operator needs local database-creation permission. No normal installation credentials or data are used.

## 1. Test environment

### Frontend team preview from the GitHub repository

The project owner has no frontend UI or frontend project available. This delivery is a backend repository handoff. The frontend team can clone the delivered branch/commit, run the API locally, inspect Swagger and execute the included API/database tests before connecting their own UI. Actual browser integration remains NOT TESTED until that team runs it.

Start with the [frontend handoff and acceptance checklist](docs/BACKEND_PROJECT_REPORT.md#88-frontend-team-handoff-and-acceptance-checklist): it provides all six reviewed request sequences, account/profile ID rules, error/retry handling and FE-01-FE-09 acceptance records. The owner authorized this delivery to master. Clone the commit containing this report and record its SHA; older commits may lack these safeguards.

Use a compatible Node.js runtime and PostgreSQL 15 or newer: the supplied offering index uses NULLS NOT DISTINCT. The recorded evaluation used Node.js 24.16.0 and PostgreSQL 18.4; older supported versions have not been evaluated here. Create a separate local database named teacher_evaluation_test, then run these commands from the cloned repository:

```powershell
npm.cmd ci
if (-not (Test-Path -LiteralPath .env.test.local)) {
  Copy-Item -LiteralPath .env.test.example -Destination .env.test.local
}
```

Edit .env.test.local with your local PostgreSQL credentials and a random test JWT secret. Keep DB_NAME and DATABASE_URL on teacher_evaluation_test. If a password contains URL-special characters, encode it in DATABASE_URL. Keep this file private; do not overwrite an existing tester's configuration. Then:

```powershell
npm.cmd run test:e2e:generate
npm.cmd run test:e2e:check
npm.cmd run test:e2e:migrate
npm.cmd run test:e2e:seed
npm.cmd test -- --runInBand
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run start:test
```

Open http://localhost:3000/api/docs and http://localhost:3000/api/health. For a different preview port, use npm.cmd run start:test -- --port 3001. The guarded preview runner loads .env.test.local and rejects another database, a remote host or NODE_ENV other than test. It does not load normal database credentials as its connection source. Stop with Ctrl+C.

Synthetic test logins use Password123: ADMIN admin@itc.edu.kh; LECTURER sokdara@itc.edu.kh; STUDENT student1@itc.edu.kh. Use POST /api/auth/login, copy the access_token into Swagger Authorize and follow the reviewed requests in the consolidated report. These accounts belong to the isolated seeded test database. The seed restores test passwords; run it only when other testers are not using the same database.

Record the Git commit/branch, local test results and API acceptance cases. This procedure runs the backend; it does not supply a frontend UI. Repository publication is owner-authorized; database deployment and actual frontend acceptance remain separate steps.

Run commands from `D:\internship\teacher-evaluation-api` in PowerShell. Dependencies and PostgreSQL must be available. The test runner requires Node.js 20.12 or newer; use the project's installed compatible runtime.

| Database                  | Use during testing                                                 |
| ------------------------- | ------------------------------------------------------------------ |
| `teacher_evaluation_test` | Automated API tests and manual tests with synthetic data.          |
| `teacher_evaluation`      | Normal backend database. Do not use it for destructive test cases. |

`.env.test.local` must contain `NODE_ENV=test`, `DB_NAME=teacher_evaluation_test`, and a `DATABASE_URL` pointing to that database on `localhost` or `127.0.0.1`. It also needs the app configuration, including JWT settings. Keep credentials private. `DB_NAME` and `DATABASE_URL` refer to the same database, not two databases.

Initial local alignment brought both databases to 17 migrations after protected backup/restore and a 109-case rehearsal. The academic-integrity follow-up then passed full 514 unit/471 API tests, a fresh backup/restore, 160-case restored-copy rehearsal and 16 copied-data GET checks. Current state: normal teacher_evaluation and teacher_evaluation_test both have 28 application tables/199 columns/all 18 migrations. The owner-approved normal 17 -> 18 deployment used another fresh cutover backup/restore, preserved all original values/sequences/old migration records and passed 16 read-only normal checks. Four temporary validation copies remain; application/test configurations select none. Regular synthetic tests still use teacher_evaluation_test only. Report Section 11.12 records current alignment; frontend/production acceptance remains pending.

Check configuration first:

```powershell
npm run test:e2e:check
```

Expected: `Test configuration valid: teacher_evaluation_test`. This checks configuration, not database connectivity. The test database must already exist. For first setup or after pulling existing migrations, run:

```powershell
npm run test:e2e:migrate
npm run test:e2e:seed
```

These commands deploy existing migrations and upsert synthetic fixtures into the validated test database. They do not reset it. The seed restores baseline test accounts and their passwords, so do not rerun it while another tester is using those accounts. Avoid the general Prisma seed or reset commands for this evaluation.

## 2. Run the automated checks

Run each command separately and inspect its exit code and summary before continuing:

```powershell
npm test -- --runInBand
npm run test:e2e
npm run build
npm run lint
```

- Unit tests verify service rules with mocked dependencies. They cannot establish PostgreSQL transaction behavior or full HTTP authorization.
- API tests start NestJS inside the test process, use Supertest, and connect to real PostgreSQL. You do not need to start a separate server for these tests.
- `test/consistency.e2e-spec.ts` deliberately overlaps operations against real PostgreSQL to check conflicts, rollback and historical preservation. It is included in the full API run.
- Build and lint are supporting checks; passing them does not establish business correctness.

Run one feature or scenario when investigating a failure:

```powershell
npm test -- --runInBand --runTestsByPath src/students/students.service.spec.ts
npm run test:e2e -- --runTestsByPath test/enrollments.e2e-spec.ts
npm run test:e2e -- --runTestsByPath test/consistency.e2e-spec.ts
npm run test:e2e -- --runTestsByPath test/consistency.e2e-spec.ts -t "concurrent final submissions"
npm run test:e2e -- --runTestsByPath test/integration.e2e-spec.ts
```

Keep API runs sequential on this shared test database. `--runInBand` is already configured by the runner. After a fix, rerun the failing suite and then the full relevant regression run.

To save machine-readable results, use a new output directory per evaluation:

```powershell
New-Item -ItemType Directory -Force .tmp/test-evaluation-01
npm test -- --runInBand --json --outputFile=.tmp/test-evaluation-01/unit.json
npm run test:e2e -- --json --outputFile=.tmp/test-evaluation-01/api.json
npm run test:cov -- --runInBand
```

Coverage opens at `coverage/lcov-report/index.html`. Review uncovered decision branches, particularly authorization, eligibility, history and error handling. Coverage percentage alone is not an acceptance result, and the current configuration has no enforced coverage threshold.

Latest recorded follow-up results (14 October 2026, 18:34:24 Asia/Phnom_Penh): 43 unit suites / 514 tests and 19 API suites / 471 tests passed, with zero failed/pending cases. The API total includes 86 consistency, 23 curriculum, 16 integration and 51 new academic-integrity cases; do not add subsets again. Build and migration/catalog verification passed; lint has the same five existing warnings and no errors. Earlier six progression/OpenAPI and twelve reviewed-workflow startup/Swagger/authentication/CORS checks remain separate evidence. Record your actual run and changed totals; backend checks are not frontend UI acceptance.

On this Windows environment, PowerShell's execution policy blocks `npm.ps1`. Use `npm.cmd` in place of `npm` in the commands below when that occurs; no system execution-policy change is needed.

## 3. Use one test-case structure

### Reviewed workflow evaluation

The updated backend needs migration `20261007140000_add_reviewed_operations` on its selected database. Apply it to the guarded test database with `npm.cmd run test:e2e:migrate`; do not run a normal-database migration as a test shortcut.

For each workflow, first call its preview as ADMIN, inspect the exact selection/impact, then confirm with that fresh `review_id` and unchanged input. Review IDs are UUIDs, not account IDs. Enrollment, targeting and reassignment use account IDs; bulk placement uses profile IDs.

| Workflow                 | Preview                                                                                  | Confirmation                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Enrollment               | POST `/api/course-offerings/:id/enrollments/preview`                                     | POST `/api/course-offerings/:id/enrollments/bulk`, same selection/account IDs plus review_id.       |
| Evaluation creation      | POST `/api/evaluations/create-preview`, explicit latest version and full creation input. | POST `/api/evaluations`, unchanged creation fields plus confirmed_student_ids/review_id.            |
| Reassignment             | POST `/api/course-offerings/:id/enrollments/reassignment/preview`                        | POST `/reassignment/confirm`, same account/target/source-enrollment ID plus review_id.              |
| Bulk placement           | POST `/api/students/bulk/class-group/preview`                                            | POST `/api/students/bulk/class-group/confirm`, same academic year/profile IDs/group plus review_id. |
| Assigned-version opening | POST `/api/evaluations/:id/open/preview`                                                 | POST `/api/evaluations/:id/open/confirm`, review_id, explicit decision and assigned version ID.     |
| Latest application       | POST `/api/surveys/:id/versions/:versionId/apply-to-unfinished/preview`                  | POST the same path ending `/confirm`, with review_id.                                               |

Check these in order: unchanged confirmation succeeds; same-ID relevant placement/impact drift conflicts; unrelated account name/notes changes do not conflict; wrong input/resource/caller and expiry reject; completed retry returns original counts/IDs with `already_applied=true`. Creation additionally binds selected generation/major/year labels: renaming these before confirmation requires a fresh review. Create another eligible student or remove a protected draft after completion, then retry: that new eligibility must not expand the old operation. A fresh preview is a separate operation. For retention, also close the evaluation after success and retry; it must stay CLOSED. For placement, make a later correction and retry; it must not undo the correction.

Expiry is 15 minutes for first execution; completed retries can return the saved result afterward. Another administrator's review returns 404 without its stored context. A receipt represents the original operation outcome; reload the resource for current state. New confirmation routes always require reviews. Existing legacy callers remain compatible until the operator sets `REQUIRE_REVIEWED_CONFIRMATION=true` at the agreed integration cutover and restarts the API. Then all five relevant legacy mutation routes reject omitted reviews with 400/REVIEW_REQUIRED. Do not enable that switch in school deployment before frontend callers are ready.

Run the focused real PostgreSQL reviewed cases:

```powershell
node test/run-e2e.cjs test --runTestsByPath test/consistency.e2e-spec.ts -t "Reviewed frontend operations"
```

The focused run has 19 cases; the other 67 consistency cases are skipped by this filter. Use the full API run to cover all 86. Full contract/examples and RV-01-RV-19 acceptance results are in the [consolidated report](docs/BACKEND_PROJECT_REPORT.md#95-reviewed-workflow-acceptance-results).

### Case record

For each operation, cover these applicable categories:

| Category                         | What to check                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Valid flow                       | Correct role, valid data, expected response and exact intended database change.                       |
| Invalid input                    | Missing required fields, malformed IDs, wrong types, invalid dates/enums and boundary values.         |
| Authentication and authorization | Missing/invalid/revoked token, wrong role, another user's or lecturer's resource.                     |
| Duplicate and missing resource   | Duplicate create/submit, unknown ID, deleted or unavailable dependency.                               |
| State and history                | Archived sets, DRAFT/OPEN/CLOSED evaluations, saved drafts, completed work, preserved historical IDs. |
| Concurrency and rollback         | Overlapping writes cannot cause partial changes, duplicate responses or lost updates.                 |
| Privacy and response contract    | Correct field types, pagination/filter behavior, no credential leaks or response-to-student linkage.  |

Record: case ID, feature/requirement, role, preconditions, fixture IDs, request/steps, expected HTTP status/body, expected database change, actual result, evidence, and status. Use **PASS**, **FAIL**, **BLOCKED**, or **NOT TESTED**. An unspecified school policy is BLOCKED, not PASS.

Common status meanings: 400 invalid request/business input; 401 unauthenticated; 403 forbidden; 404 unavailable resource where the endpoint specifies it; 409 duplicate, stale state or write conflict. Password-change throttling returns 429. Use the individual endpoint's Swagger contract for the exact expectation: creation, update and deletion do not all share one success status.

For every rejected mutation, verify that no unintended row, answer, enrollment or participant change was committed. A status code alone is insufficient evidence.

## 4. Feature checklist and existing test locations

All route prefixes below start with `/api`. "No dedicated API suite" means other tests may use the feature as setup, but that is not a complete test of its endpoints. A controller test that only checks `should be defined` does not prove HTTP behavior.

| Feature / route                                                             | Required evaluation cases                                                                                                                                                                                                                      | Existing automated starting point                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Startup, Prisma, health, Swagger                                            | Test database connection; `/health`; `/docs`; BigInt IDs serialize as strings; validation strips unknown fields; browser CORS for allowed frontend origin.                                                                                     | `src/app.controller.spec.ts`; API suites exercise startup/Prisma. Bootstrap/Swagger/CORS need separate manual verification.            |
| Authentication `/auth`                                                      | Email and student-code login; wrong password; inactive account; `/me`; password change, old token revocation, password boundaries and sixth password-change attempt in a minute.                                                               | `src/auth/*.spec.ts`, password guard spec, Auth cases in `test/app.e2e-spec.ts`. Full password HTTP flow needs additional evaluation.  |
| Users `/users`                                                              | Account CRUD, search/pagination, duplicate email/code, role/status changes, protected deletion, department membership and primary department.                                                                                                  | `src/users/*.spec.ts`, `test/users.e2e-spec.ts`.                                                                                       |
| Departments `/departments`                                                  | CRUD, duplicate code/name rules, status, unknown ID, deletion with dependents, non-admin writes denied.                                                                                                                                        | `src/departments/*.spec.ts`; no dedicated API suite.                                                                                   |
| Majors `/majors`                                                            | CRUD, department association, duplicate code, missing department, dependent deletion.                                                                                                                                                          | `src/majors/*.spec.ts`; no dedicated API suite.                                                                                        |
| Academic years `/academic-years`                                            | CRUD, start year, active-year rules, duplicate names, dependent deletion, historical preservation.                                                                                                                                             | `src/academic-years/*.spec.ts`; no dedicated API suite.                                                                                |
| Semesters `/semesters`                                                      | Explicit semester number within academic year, duplicate context, missing year, date validation and dependent deletion.                                                                                                                        | `src/semesters/semesters.service.spec.ts`, `test/semesters.e2e-spec.ts`.                                                               |
| Student generations `/student-generations`                                  | CRUD, entry year association, duplicates, effective year calculation, protected deletion.                                                                                                                                                      | `src/student-generations/*.spec.ts`; no dedicated API suite.                                                                           |
| Students `/students`                                                        | Atomic account/profile/initial placement creation, optional fields, duplicates, selected-year filters, normalized group options, update/delete protections.                                                                                    | `src/students/students.service.spec.ts`; consistency cases cover selected flows. No dedicated CRUD API suite.                          |
| Academic records `/student-academic-records`                                | One placement per student/year, explicit major/group/year level, 1 and 5 boundaries, reject 0/6, selected-year override, later changes preserve past assignments.                                                                              | `src/student-academic-records/*.spec.ts`, related students specs; no dedicated API suite.                                              |
| Bulk class group `/students/bulk/class-group`                               | Exact profile IDs and selected year, normalized group, all-or-nothing if any placement is missing, race with individual edit, no automatic enrollment move.                                                                                    | Students service spec and `test/consistency.e2e-spec.ts`.                                                                              |
| Import `/students/import`                                                   | Valid rows, duplicate normalized codes, existing account skipped, unknown/ambiguous major, password bounds, row failure reporting without partial account/profile. Successful other rows remain imported by design.                            | `src/students/student-import.service.spec.ts`; no dedicated API suite.                                                                 |
| Export `/students/export`                                                   | Correct year/semester/group scope, empty scope, progress totals, context required, no passwords or anonymous answer linkage. Participation export is identifiable staff data and must remain ADMIN-only.                                       | `src/students/student-export.service.spec.ts`; no dedicated API suite.                                                                 |
| Student progress                                                            | Active versus upcoming/expired/CLOSED evaluations, submitted counts, deduplication and zero denominator, selected placement context.                                                                                                           | `src/students/student-evaluation-progress.service.spec.ts`; verify fields through student list/detail/export HTTP responses.           |
| Courses `/courses`                                                          | CRUD, duplicate course code, input validation, protected dependent deletion, authorization.                                                                                                                                                    | Courses cases in `test/app.e2e-spec.ts`; no dedicated course service spec.                                                             |
| Curriculum `/course-year-rules`                                             | Course/major/year/class-type association, filtering, duplicates, invalid dependencies, year boundaries. Do not invent expected effective-year/revision rules.                                                                                  | `src/course-year-rules/course-year-rules.service.spec.ts`; no dedicated API suite.                                                     |
| Offerings `/course-offerings`                                               | Valid course/lecturer/semester/context, duplicate uniqueness, COURSE/TD/TP distinction, saved A-only/A+B scopes, update/delete protections. Section text cannot establish eligibility.                                                         | Course offerings service spec, `test/course-offerings.e2e-spec.ts`, consistency suite.                                                 |
| Lecturer offerings `/lecturer/course-offerings`                             | Only owned offerings, filters and missing/wrong-role token. A second lecturer cannot see the first lecturer's assignments.                                                                                                                     | Lecturer offerings controller spec; no dedicated API suite for this route.                                                             |
| Enrollment `/course-offerings/:offeringId/enrollments`                      | Single/bulk/preview use the same ACTIVE/year/generation/major/year-level/group rules; exact confirmed account IDs; A-only rejects B; A+B accepts both; duplicates and legacy no-scope behavior.                                                | Enrollment service spec, `test/enrollments.e2e-spec.ts`, consistency suite.                                                            |
| Reassignment under enrollment route                                         | Preview/confirm only intended account; compatible saved scopes; protected draft/completed work; stale preview and concurrent draft saving; full rollback.                                                                                      | Enrollment service spec and consistency suite.                                                                                         |
| Question sets `/surveys`                                                    | Atomic first version, title uniqueness, usage, update, archive, continuing existing assignments, reject new archived assignments, protected delete.                                                                                            | Survey lifecycle spec, `test/surveys.e2e-spec.ts`, consistency suite.                                                                  |
| Versions `/surveys/:surveyId/versions`                                      | Clone preserves previous version, sequential version numbers, same-set ownership, archive/delete restrictions, latest checks, no silent empty-version fallback.                                                                                | Version service/lifecycle specs, `test/survey-versions.e2e-spec.ts`, consistency suite.                                                |
| Apply newer version to unfinished                                           | Preview exact proposed moved/skipped impact; confirm unchanged review; preserve drafts/completions/base versions; reject drift; safe NULL movement; no downgrade; overlapping save rollback; completed retry cannot move newly eligible users. | Version lifecycle spec and reviewed PostgreSQL consistency cases; actual frontend cutover pending.                                     |
| Questions `/survey-versions/:versionId/questions`, `/questions/:questionId` | All six types, valid options, type-specific bounds, option ownership, reorder uniqueness/atomicity; assigned and older questions immutable; edit/use race.                                                                                     | Question lifecycle spec, `test/questions.e2e-spec.ts`, `test/questions-reorder.e2e-spec.ts`, consistency suite.                        |
| Evaluations `/evaluations`                                                  | Participant preview/exact confirmation, frozen targets, schedule validation, DRAFT -> OPEN -> CLOSED, stale version create/open, archived continuity, duplicate/delete restrictions.                                                           | Evaluation service/lifecycle specs, `test/evaluations.e2e-spec.ts`, consistency suite.                                                 |
| Student access `/student/evaluations`                                       | Assigned-only list/history/survey/status, correct effective version, active schedule, already submitted, inactive/nonparticipant/wrong role.                                                                                                   | Student access service spec, `test/student-access.e2e-spec.ts`.                                                                        |
| Drafts `/student/evaluations/:id/draft`                                     | Save/read/replace/delete, ownership, partial answer contract, all question types, version pinning, closed/unassigned access, saving after submit and races.                                                                                    | Draft service spec, `test/assessment-drafts.e2e-spec.ts`, consistency suite.                                                           |
| Final response `/student/evaluations/:id/responses`                         | All required answers, six types, bounds/options/duplicate question rejection, active schedule, submit once, draft removed, exactly one anonymous response under concurrent submission.                                                         | Submission service spec, `test/submissions.e2e-spec.ts`, consistency suite.                                                            |
| Lecturer dashboard `/lecturer/evaluations`, `/:id/dashboard`                | Owned evaluations, response rate and counts, zero responses, OPEN/CLOSED visibility, other lecturer denied, actual submitted-version questions.                                                                                                | Dashboard service spec, `test/lecturer-dashboard.e2e-spec.ts`, consistency suite.                                                      |
| Comments `/lecturer/evaluations/:id/comments`                               | Owned evaluation, only appropriate text answers, actual response version, no student linkage, missing/foreign resource.                                                                                                                        | `test/comments.e2e-spec.ts`, consistency suite; no dedicated comments service spec.                                                    |
| Results `/admin/results`, `/admin/results/:lecturerId`, `/lecturer/results` | Role/ownership, hand-calculated aggregates, six types, V1/V2 separated, unknown version count explicit, no response-to-student linkage. Legacy dashboard flat shape is distinct from canonical per-version results.                            | Results service/controller specs and consistency suite; no dedicated API suite for complete results authorization/aggregation.         |
| Historical recovery operator tool                                           | Synthetic records only: evidence required, ambiguous preserved, dry-run unchanged, apply/rollback idempotence, fingerprint drift rejects whole batch, timestamps/answers unchanged.                                                            | Recovery cases in `test/consistency.e2e-spec.ts`; CLI packaging/backup/restore needs separate operator evaluation. See recovery guide. |

## 5. Manual API evaluation with Swagger or Postman

Start an isolated test server after the configuration check and test seed above:

```powershell
npm run build
node -e "require('./test/run-e2e.cjs'); require('./dist/main.js');"
```

This loads the validated test environment before starting NestJS. Normal `npm run start:dev` uses the regular environment. The test server uses the configured `PORT`, default 3000. Stop it with Ctrl+C when finished.

Open `http://localhost:3000/api/docs` (adjust the port if configured differently). The test seed provides these synthetic accounts with password `Password123`:

| Role            | Login identifier                                                    |
| --------------- | ------------------------------------------------------------------- |
| ADMIN           | `admin@itc.edu.kh`                                                  |
| LECTURER        | `sokdara@itc.edu.kh`                                                |
| Second LECTURER | `chanthy@itc.edu.kh`                                                |
| STUDENT         | `student1@itc.edu.kh`, `student2@itc.edu.kh`, `student3@itc.edu.kh` |

POST `/api/auth/login` with `{ "identifier": "admin@itc.edu.kh", "password": "Password123" }`. Copy `access_token` into Swagger Authorize. In Postman use Bearer Token authorization. Keep separate tokens for each role; repeat authorization checks with the second lecturer and another student.

Create your own uniquely named fixtures, such as `MANUAL-20261007-01`, and record every returned ID. Do not hard-code ID `1`, edit baseline `E2E BASE` fixtures, or run manual mutations alongside the automated suites.

Important ID distinction: student CRUD and bulk placement use **student profile IDs**; enrollment, reassignment and `confirmed_student_ids` use **account IDs**. Both are returned as strings. Test the correct IDs deliberately; accidental equality between profile/account IDs can hide a bug.

Follow this dependency order for a complete new scenario:

1. ADMIN creates department, major, academic year, semester and generation; creates lecturer and students with selected-year placements.
2. Creates course, curriculum rule and offering with explicit scope. Use group A plus an otherwise similar B student and another-generation A student as negative controls.
3. Previews enrollment; checks the exact account IDs; confirms; verifies only intended enrollments exist.
4. Creates a question set and its questionnaire. Cover `RATING`, `TEXT`, `AGREEMENT`, `FREQUENCY`, `MULTIPLE_CHOICE`, and `CHECKBOX`; prepare answers according to each question's configured bounds/options.
5. Previews evaluation participants; creates the evaluation with reviewed `survey_version_id` and exact confirmed IDs; records frozen membership; sets a valid schedule and opens it.
6. STUDENT sees only the assigned survey; saves and reloads a draft; submits once. Verify draft removal, completed status, rejection of a second submission and exclusion of an unassigned student.
7. LECTURER checks the owned evaluation list; the second lecturer is denied access to the first lecturer's dashboard/comments. The owner's dashboard/comments return 409 until the evaluation closes.
8. ADMIN creates V2 while a different student has a V1 draft. Applying the latest version keeps that draft pinned; only safe unfinished participants move. Submit appropriate V1 and V2 answers and verify separate canonical version results.
9. Test ordinary stale creation/opening, A-only/shared scope, and history after placement changes. For intentional older-version retention, call POST `/api/evaluations/:id/open/preview`, then `/open/confirm` with `review_id`, `decision: "RETAIN_ASSIGNED_VERSION"` and the assigned `retain_assigned_version_id`. Check expiry/drift rejection and exact frozen participants. Never use a force flag.
10. Close the evaluation; verify student writes return 409. LECTURER checks counts, comments and canonical version results; ADMIN checks aggregate results. Record protected deletion behavior. Clean up only your own disposable fixture IDs where permitted; retain evidence needed for reviewing protected history.

For aggregate accuracy, prepare a tiny known dataset. For a rating question permitting 2 and 4, two answers of 2 and 4 must have mean 3 and count 2 in that version's result. Keep V1 and V2 calculations separate; compare expected checkbox/choice counts against each selected option, not just the total participant count. Submitted/assigned response rates need the exact frozen denominator used by the endpoint.

## 6. Frontend requirement evaluation

Run the full suites and then review these demonstrations against [the implementation review](docs/BACKEND_PROJECT_REPORT.md#7-backend-improvement-requirements-and-delivery-status):

| Handoff requirement        | Demonstration and remaining acceptance limit                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Eligibility             | A-only versus A+B; wrong year/generation/major/year-level/group; inactive account; consistent single/bulk/reassignment behavior; documented legacy behavior.                                                                                                                                                                                                         |
| 2. Concurrency             | Run reviewed consistency cases: same-ID context drift, unrelated-field allowance, expiry/caller/input/resource binding, durable exact retry, simultaneous confirmation and complete rollback. Verify bypass rejection with cutover enabled.                                                                                                                          |
| 3. Questionnaire lifecycle | Ordinary stale opening conflicts; explicit reviewed retention opens valid assigned V1 with current V2; changed review conflicts; invalid dates/empty/archived versions fail; questions/membership remain protected. Reviewed creation requires explicit version; legacy mandatory selection awaits cutover.                                                          |
| 4. Progression exceptions  | Approved and implemented: test repeat/transfer from last approved placement, persistent pause and explicit resume, missing/null/blank annual group, cross-API agreement, stale reviewed confirmation and preservation. Twelve PostgreSQL cases and sixteen resolver cases pass; actual frontend acceptance remains pending.                                          |
| 5. Apply to unfinished     | ADMIN preview/confirm, exact proposed/committed counts and skipped reasons, protected drafts/completions/base versions, same-set latest, safe NULL movement, race rollback and original receipt replay without additional movement.                                                                                                                                  |
| 6. Historical metadata     | Synthetic recovery scenarios and truthful unversioned counts. Passing them does not authorize school data recovery or prove official provenance/backup recovery.                                                                                                                                                                                                     |
| 7. Curriculum/title policy | Approved academic-year revisions and global titles are implemented; 23 PostgreSQL cases pass. Test saved bindings, withdrawals/reapproval, stale selections, chronology, concurrent approvals and global/archived title collisions. Local normal migration is complete through 18 migrations; frontend adoption and another school target deployment remain pending. |
| 8. Historical labels       | Approved snapshots are implemented. Verify historical_labels/current_labels separation, UNKNOWN legacy names, rename-stale reviews, stable retry, unchanged drafts/answers and explicit rejection of anonymous query slicing. Ten PostgreSQL and eight unit cases pass.                                                                                              |

A concurrent confirmation may serialize before a later placement/status change. A complete reviewed snapshot followed by that later change can be valid. Require consistent atomic history or a conflict; do not demand 409 for every overlap. Deterministic overlap tests in the consistency suite are stronger evidence than manually clicking Submit twice.

## 7. Record results and decide acceptance

Copy [the evaluation template in Appendix C](docs/BACKEND_PROJECT_REPORT.md#appendix-c-reusable-evaluation-record) for each test round. Capture timestamp, workspace revision/change summary, environment, commands, counts, case evidence and defects. Use synthetic evidence and omit passwords/tokens from screenshots and reports.

Review the feature coverage matrix for gaps in dedicated HTTP authorization and edge cases, particularly students, import/export, lecturer offerings and results/password workflows. Existing curriculum and academic-integrity suites provide dedicated coverage; setup calls and mocked service tests do not replace missing endpoint checks. Backup/restore and isolated bootstrap/CORS checks have separate recorded evidence, while actual frontend browser acceptance and school-sized load evaluation remain pending; the functional suite alone does not establish them. Agree school load targets before performance testing; record concurrent users, data volume, latency, errors and PostgreSQL behavior on a suitable test environment.

Accept a feature only when applicable cases pass, expected database effects are verified, and material defects are resolved. Record unresolved policy/contract items as BLOCKED. A passing test count is useful evidence, but does not make all eight frontend requirements complete.

## Approved progression evaluation

The user approved repeat/transfer progression from the last approved placement, persistent pause until explicit RESUME, and a required yearly group. Progression and all later migrations are now applied to both configured local application databases (18 total; report Section 11.12). The following counts describe earlier evaluation rounds, rather than the current 514 unit/471 API totals. The earlier progression delivery passed 40 unit suites / 492 tests and 17 API suites / 365 tests; the later curriculum delivery passed 18 API suites / 388 tests. The API total includes 54 consistency cases, 12 specifically for progression. All passed. Lint has five existing warnings and no errors.

Run the policy checks in PowerShell (use npm.cmd if execution policy blocks npm.ps1):

```powershell
npm.cmd test -- --runInBand --runTestsByPath src/common/utils/student-placement.util.spec.ts
npm.cmd run test:e2e -- --runTestsByPath test/consistency.e2e-spec.ts -t "Approved student progression"
```

For manual testing, authenticate as ADMIN and use POST/PUT /api/student-academic-records with profile IDs and progression_action NORMAL/REPEAT/TRANSFER/PAUSE/RESUME. Choose structured academic years, the approved actual level/major and an explicit group. Test a repeat or transfer whose original generation formula differs from its approved placement; compare Students academic_context and export academic_context, enrollment previews, single enrollment and evaluation targeting. A calculated future year must never inherit the old group.

Pause an assigned student and confirm questionnaire access, available evaluations, draft saving, submission, new enrollment and reassignment reject eligibility. A later NORMAL record or group edit must not resume the student. Explicitly RESUME and verify that a missing yearly group still blocks eligibility; assign a group and check access again. Compare exact frozen participant, original enrollment, saved draft/version and response rows before/after. Test invalid/null action, missing/conflicting chronology and resume without pause. Change progression after a reviewed preview and require 409 with no enrollment or completed receipt; completed retries must keep the original result.

The 12 SP acceptance scenarios and requests/errors are recorded in Sections 8.5 and 9.6 of the consolidated report. Raw progression evidence is ignored under .tmp/progression-unit-final.json and .tmp/progression-api-final.json; the newer historical-label full runs include these regressions. Historical-label and curriculum policies are approved and implemented. Local normal deployment is complete through 18 migrations. Actual frontend integration and deployment to any other school target remain separate acceptance work.

The requested guided four-step walkthrough was executed against the built test API on 08 October 2026 at 01:13:16, Asia/Phnom_Penh. All four scenarios passed: repeat/transfer, pause/resume, missing yearly group and preservation of drafts/completed history. There were 87 HTTP assertions and 42 database assertions; these are separate from the Jest totals. The 16 resolver cases and 12 PostgreSQL progression cases also passed a focused rerun. Temporary fixtures were removed, the owned server was stopped and the normal database was unchanged. Section 9.7 of the consolidated report records the exact outcomes. Raw sanitized evidence is .tmp/four-progression-scenarios-result.json. The configured frontend at http://localhost:5173 was unavailable, so actual browser integration remains NOT TESTED.

## Approved curriculum revisions and retained global titles

Requirement 7 is approved and implemented. Fresh full regression: 40 unit suites/492 tests and 18 API suites/388 tests passed. The new test/curriculum-revisions.e2e-spec.ts contributes 23 PostgreSQL cases, already included in 388. Nine built-server Swagger/JWT/cleanup checks also passed. The additive 20261008020000_add_curriculum_revisions migration was initially test-only and is now included in the completed local normal alignment (18 total; report Section 11.12). These counts record the earlier feature evaluation; current full results are 514 unit/471 API tests.

```powershell
npm.cmd run test:e2e:check
npm.cmd run test:e2e:migrate
npm.cmd run test:e2e -- --testPathPatterns curriculum-revisions
```

Use ADMIN to create a rule with effective_academic_year_id, inspect /:id/revisions and /:id/applicable?academic_year_id=..., and create a scoped offering with its expected curriculum_revision_id. Append a later-year enabled:false withdrawal: new assignments reject with 409, while saved bindings, enrollment, frozen participants, drafts and answers stay unchanged. Append a still later enabled:true revision to resume new assignments. Same-year/backdated revisions, wrong/obsolete selections and edits/deletion of revisioned identities must reject. Moving a course to another level uses a new rule identity. Legacy/unscoped null bindings are unknown compatibility state, not historical backfill.

Create and rename titles under different ADMIN accounts/departments; case changes and surrounding whitespace cannot bypass global uniqueness. Archive a set and verify that its title remains reserved. Overlapping creation attempts must commit one set only. Section 8.6 documents requests/errors and Section 9.8 maps all 23 acceptance cases. Raw evidence is .tmp/curriculum-*.json. Actual frontend integration and school deployment remain separate acceptance work.

## Approved immutable historical target labels

Requirement 8 is approved and implemented. Latest full results: 41 unit suites/500 tests and 18 API suites/398 tests. Ten new PostgreSQL cases are included in the 64 consistency cases; eight new helper cases are included in the unit total. The additive 20261008030000_add_historical_target_labels migration was initially test-only and is now included in the completed local normal alignment (18 total; report Section 11.12). These counts record the earlier feature evaluation; current full results are 514 unit/471 API tests. Older target names remain null and UNKNOWN; no current names were backfilled.

```powershell
npm.cmd run test:e2e -- --testPathPatterns consistency -t "Immutable historical target labels"
npm.cmd test -- --runInBand --testPathPatterns target-labels
```

Preview/confirm a scoped evaluation and inspect target_labels, then saved historical_labels/capture time. Rename generation, major and year before first confirmation: expect 409/REVIEW_STALE and no partial rows; fresh review captures new names. Rename after confirmation: saved labels remain unchanged, current_labels reflect the rename, and drafts/completed answers retain their exact rows. Retry a completed review: its original result remains stable; reload for live current labels. Opening/closing/version application must not recapture names. Older targets show UNKNOWN/LEGACY_LABELS_NOT_CAPTURED and must never substitute today's name as historical proof.

Use historical_labels for historical display. Existing name/relation fields retain current-name compatibility semantics. Inspect all canonical/lecturer/evaluation target readers. Anonymous reports reject query parameters with 400/UNSUPPORTED_ANONYMOUS_SCOPE, including mixed/unknown single-generation/group slices; unfiltered reports retain whole aggregates and expose no student-answer link. Detailed contract/case mapping is in Sections 8.7 and 9.9. Raw evidence is .tmp/labels-*.json. Actual frontend integration remains for the frontend team; repository publication has the owner's explicit permission.

## Approved lecturer release and teaching-history policies

The two approved rules are included in this owner-authorized master delivery. No schema migration is required. Sections 8.9 and 9.11 of the consolidated report describe the contract and POL-01-POL-12 evidence.

1. Submit synthetic feedback to an OPEN evaluation. As its lecturer, GET /api/lecturer/results must omit that evaluation and its answers/comments. Dashboard/comments return 409 before close. ADMIN monitoring still sees the OPEN evaluation. Close it; all three lecturer result surfaces then release owned results. Another lecturer cannot access it. A lecturer with no closed evaluations receives 200 with an empty evaluations array.
2. For each DRAFT/OPEN/CLOSED evaluation, try changing its offering's course_id, lecturer_id and semester_id. Expect 409/OFFERING_HISTORY_PROTECTED and unchanged IDs, scopes, enrollments, drafts, participants and answers. Try moving its semester to another academic_year_id; expect 409/SEMESTER_HISTORY_PROTECTED. Unused contexts, identical IDs and permitted display edits still succeed.
3. Run the real overlap cases proving evaluation creation and context updates serialize atomically. Guards execute in existing protected service transactions; this phase introduces no direct-SQL protection triggers.

```powershell
npm.cmd run test:e2e -- --runTestsByPath test/consistency.e2e-spec.ts -t "Closed lecturer results and teaching history"
```

The original policy run recorded 12 passed/64 skipped and full totals of 500 unit/410 API tests. With the subsequent primary-department cases present, this filter runs 12 and skips 74 of the 86 consistency cases; the primary-department-stage full totals were 502 unit/420 API tests; current full totals are 514 unit/471 API tests. Policy fixtures are owned synthetic data. No normal/school database changes, reset or publication occurred; the primary migration was initially test-only and later included in the approved normal alignment (report Section 11.8); academic integrity was first test-only (Section 11.10), then applied to local normal after backup/rehearsal and approval (Section 11.12). Actual frontend UI acceptance remains pending.

## One primary department per user

The additive migration 20261014010000_enforce_one_primary_department was initially applied to teacher_evaluation_test, then to local normal during the approved backup/rehearsal/alignment step in report Section 11.8. An audit found no duplicates and the three original membership counts remain. The SQL partial unique index restricts primary rows only; multiple non-primary memberships and zero primary remain valid. It blocks direct SQL duplicates as well as application races. Intended/school database deployment requires its own audit, approved corrections if needed, and restorable backup. The migration refuses duplicates and changes no data automatically.

Use POST /api/users/:id/departments as ADMIN with numeric department_id and is_primary:true. Verify atomic switching, preserved secondary memberships/created_at values, consistent GET department/profile flags and 201. Omitted/false is_primary retains non-primary behavior; deleting a primary does not choose another. Wrong-role/invalid/inactive-reference requests leave existing assignments intact. Concurrent conflicts return 409/DEPARTMENT_ASSIGNMENT_CONFLICT; reload memberships before a deliberate retry.

```powershell
npm.cmd run test:e2e -- --runTestsByPath test/consistency.e2e-spec.ts -t "One primary department per user"
```

Focused result: 10 passed, 76 skipped. Primary-stage regression: 502 unit / 420 API tests; current full regression: 514 unit / 471 API tests, including all 86 consistency cases. Verify actual SQL enforcement and the exact migration on clean/duplicate temporary tables; no public index is dropped and no seed records are rewritten. Full contract/preflight SQL and PD-01-PD-10 evidence are in report Sections 8.10/9.12. Raw evidence is .tmp/primary-departments-*.json and .tmp/primary-departments-schema-diff.sql. UI evaluation remains pending; the owner subsequently authorized publication of this tested delivery to master.

## Academic-integrity safeguards

The 20261014020000_enforce_academic_integrity migration is applied to both teacher_evaluation_test and local normal after approved backup/restore/rehearsal/deployment. Both now have 18 migrations; synthetic fixture tests continue to target only teacher_evaluation_test. The guarded migrate command validates the test configuration and does not reset/seed data. API discovery is confined to test/**/*.e2e-spec.ts, excluding temporary rehearsal adapters.

```powershell
npm.cmd run test:e2e:check
npm.cmd run test:e2e:migrate
npm.cmd test -- --runInBand --runTestsByPath src/common/utils/calendar-date.util.spec.ts src/common/utils/database-constraint.util.spec.ts
npm.cmd run test:e2e -- --runTestsByPath test/academic-integrity.e2e-spec.ts
```

The focused unit result is 12 cases and the focused PostgreSQL result is 51 cases. All are included in the latest 514 unit/471 API totals. Use ADMIN requests with owned fixtures to check these contracts:

| Evaluation area                | Expected behavior                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Academic years                 | Zero active and many inactive remain valid. Activating another year demotes the old one atomically. Simultaneous activation preserves at most one active; a conflict returns 409 and can be deliberately retried.             |
| Questionnaire titles           | Trimmed case-equivalent titles collide globally, including archived sets. Percent/underscore/backslash are literal. Distinct titles remain usable; a true collision returns 409. Whitespace-only titles return 400.           |
| Offerings                      | All six assignment-key fields determine identity. A repeated combination returns 409 even with optional NULL fields. Different case-sensitive sections, empty string and NULL remain distinct.                                |
| Generation / other levels      | Starting and other known year levels must be 1-5. Omitted generation starting level still defaults to 1. Invalid generation create/update returns 400 without changing the row.                                               |
| Calendar dates                 | Academic-year/semester ISO input resolves to a UTC calendar day; unqualified datetimes mean UTC. Compare dates after discarding time. Equal/reversed complete dates return 400. Optional null/partial endpoints remain valid. |
| Evaluation timestamps          | start_at/end_at retain time precision; an ordered same-day interval remains valid. Other lifecycle checks still apply.                                                                                                        |
| Direct SQL / migration refusal | Named CHECKs and unique indexes reject bypass attempts. Exact migration tests use temporary dirty tables and verify no winner-selection, row repair or partial index. Do not bypass constraints on school data.               |

The suite removes its owned accounts, academic structure, offerings and questionnaire versions. Existing consistency/curriculum/integration tests also pass with the stronger rules. Sections 9.1/11.10 record full regression, Section 11.11 records rehearsal, and Section 11.12 records approved normal alignment and preserved data. Browser UI acceptance and school-sized load remain separate pending steps; publication to master is owner-authorized. The 160 rehearsal cases and both sets of 16 read-only copied/normal GET checks are separate evidence, not extra cases to add to 514/471. Regular synthetic tests still select teacher_evaluation_test only; do not run write-based fixtures against normal.
