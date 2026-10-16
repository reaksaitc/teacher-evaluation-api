# Backend alignment contracts

This document supersedes the remaining-work assumptions in the root `improve.txt` and the original alignment inspection. It describes backend implementation and frontend integration contracts. It does not claim that the sibling frontend implements the newer controls, or that these migrations have been deployed to an existing installation.

## Capabilities and ownership

Authenticated `/auth/me` and sign-in user objects advertise the flags in `src/auth/backend-capabilities.ts`. The exact flags required by `improve.txt` are `major_scoped_generations`, `evaluation_activity_v1`, and `bulk_evaluations_v1`. Additional versioned flags cover atomic setup, group/assignment rollover, automatic course codes, atomic assignments, plural audience targeting, major-filtered results, and atomic publication.

An active ADMIN without department memberships has installation-wide setup authority. An ADMIN with memberships is restricted to those departments for the new writes, evaluation readers/actions, assignment readers/actions, setup copying, and admin aggregate results. Setup reports do not enumerate students/assignments outside the administrator's permitted departments. Lecturer result ownership remains enforced separately. Students retain authenticated academic-year reads and access only their own profile and assigned evaluations.

Authenticated offering reads remain available to existing student/lecturer clients, restricted to enrolled/assigned offerings for students and owned offerings for lecturers. New counts do not grant access to another class.

Frontend ownership includes screens/selectors, field mapping, wording, capability checks, and retiring browser copy/write loops. Backend ownership includes validation, authoritative counts, eligibility, transactions, idempotency, history, authorization, migrations, API documentation, and tests. Do not enable a UI feature merely because a table exists; use its deployed capability and documented request contract.

New setup/course idempotency receipts and assignment/evaluation reviews bind the administrator's department access as well as input. Changing that access blocks confirmation/replay (`IDEMPOTENCY_INPUT_MISMATCH` or `REVIEW_SCOPE_CHANGED`) instead of disclosing a previously authorized receipt under different access. Active administrator checks still apply. Successful receipts remain recoverable after preview expiry when actor access and input are unchanged.

## A, K: evaluation audiences and frozen metadata

Both `POST /evaluations/participants/preview` and the full `POST /evaluations/create-preview` accept the existing audience fields plus:

```json
{
  "course_offering_id": "40",
  "participant_scope": "SELECTED_GENERATIONS",
  "generation_ids": ["5", "12"],
  "major_ids": ["3", "4"],
  "group_scopes": [
    {
      "academic_year_id": "7",
      "generation_id": "5",
      "major_id": "3",
      "year_level": 3,
      "class_groups": ["A", "B"]
    },
    {
      "academic_year_id": "7",
      "generation_id": "12",
      "major_id": "4",
      "year_level": 3,
      "class_groups": ["C"]
    }
  ]
}
```

Scopes form a deduplicated union; that union is intersected with eligible offering enrollments, selected generations, and optional major restrictions. Supplying singular `group_scope` remains supported. Supplying both singular and plural scopes, empty arrays, invalid scopes, or conflicting explicit group restrictions fails. Omit `major_ids` for all eligible enrolled majors. A major-only restriction does not require generation/group selection. Omit both group fields for all eligible enrolled groups; this never creates enrollments or targets an entire department.

Previews return the complete roster, exact `confirmed_student_ids`, per-student major/group/cohort context, and `audience_breakdown` entries with major IDs, captured display labels, groups, and counts. Breakdown counts sum to the unique eligible roster. Unknown display metadata retains an explicit unavailable label.

Full creation reviews bind schedule, explicit latest questionnaire version, input restrictions, exact membership/placement/progression context, and server-authored labels. Confirm with unchanged input, returned review ID, and exact reviewed account IDs. Existing reviewed-operation expiry and drift checks apply.

New confirmed participants store immutable `placement_snapshot` values. Group/generation targets retain captured labels. Evaluation list/details retain existing participant/response counts and add `filter_metadata` with academic year, semester number, department, paired audience major/year values, and `COMPLETE`/`UNAVAILABLE` status. Unknown historical audiences are never reconstructed from current placements. Plain legacy ALL_ENROLLED drafts can still freeze their first participants on publication; those new participants also capture their placement then. Already-existing snapshots/results are not backfilled or relabeled.

## A, R, S: results, exports, and privacy

The aggregate endpoints accept optional `?major_id=<string ID>`:

- `GET /admin/results` and `/admin/results/:lecturerId`
- `GET /lecturer/results`
- JSON dataset exports at `/admin/results/export`, `/admin/results/:lecturerId/export`, and `/lecturer/results/export`

The export and ordinary endpoint use the same aggregation and privacy projection. Export is a JSON dataset; frontend spreadsheet generation can consume the same filtered data. Captured filter labels are included in `audience_filter`.

Anonymous responses capture only an evaluation-time major tag/label copied from the immutable participant snapshot. They do not gain student or participant references. The same response subset drives participant/submission counts and rating, choice, checkbox, and text aggregates. Default results remain combined. Historical records without trustworthy audience capture return `409 LEGACY_AUDIENCE_UNAVAILABLE` when slicing is requested; their combined results remain available. Arbitrary generation/group/identity query slicing remains unsupported. Other legacy dashboard/comment endpoints continue rejecting unsupported slicing instead of silently returning a whole report.

The existing lecturer release rule is preserved: answer results and written comments require ownership and persisted `CLOSED` status. A deadline naturally elapsing does not itself change persisted status or constitute administrator release. Participation totals remain distinct from answer release. Release metadata states that no minimum-response threshold is configured. No new threshold or release policy has been invented; an institution-approved threshold and overlapping-filter suppression policy remain a business decision.

Reports omit student names/codes, participant IDs, and response IDs. This is not a promise of complete anonymity: small cohorts and identifying free text can reveal identity. Authorized administrators can manage identifiable participation/placement records through their authorized APIs; aggregate reports do not attach answers to those records. Do not join anonymous answers to student identity to manufacture historical filters.

`/auth/me` now preserves `student.academic_context`, including the selected year's record/group, progression, eligibility, and reason. Missing current-year placement never falls back to an older group. Student evaluation summaries include class type, course code, section/class label, semester number, and active academic-year metadata. `section_code` is a teaching class label, not an academic group.

## B, C, F, I: atomic academic-year setup and recovery

```http
POST /api/academic-years/setup
```

```json
{
  "name": "2027-2028",
  "start_year": 2027,
  "is_active": true,
  "idempotency_key": "year-2027-setup-01",
  "create_semesters": true,
  "semesters": [
    { "start_date": "2027-10-01", "end_date": "2028-02-01" },
    { "start_date": "2028-02-10", "end_date": "2028-07-31" }
  ]
}
```

The setup endpoint defaults `create_semesters=true` and requires the retry key. Existing `POST /academic-years` remains compatible and creates semesters only when explicitly requested. All documented year creation goes through the shared setup service, including automatic group/assignment initialization. Existing independent semester CRUD remains available.

Year creation, activation, requested semesters, copied placements, assignment initialization, audit, and receipt commit together. Dates are checked before writes. The immediately preceding structured `start_year` identifies the source; ambiguous chronology fails. A year without structured chronology remains supported for compatibility and reports rollover unavailable. No predecessor produces no inherited records.

Only missing destination placements are initialized, including preservation of intentionally blank existing groups. Active continuing students use the authoritative progression resolver. Paused, unresolved, beyond-program, disabled, and unsupported transfer contexts are skipped/reported. Group records remain independent per year and retain student/cohort identity links.

Assignment copies have new IDs, destination semesters, separately pinned applicable revisions, and persisted `source_offering_id`. Course year levels stay unchanged. Destination eligible placements remap cohort/group contexts; missing or ambiguous mappings skip the whole assignment. Existing copies/manual identities are preserved. No enrollments, evaluations, questionnaires, schedules, participants, or answers are copied. The next setup reads its immediately preceding year, including intervening edits.

The response includes the year, saved semester IDs, authoritative copied/preserved/skipped counts, copied IDs, and reasons. Audit records preserve source/destination provenance. Successful retry receipts have no preview TTL.

`POST /academic-years/:id/setup` finishes an existing year's missing setup using its existing name/start year and a new stable retry key. It creates only missing semester numbers and never overwrites existing semester names/dates, placements/groups, or assignment copies. It does not create another academic year.

Date updates preserve the C contract: omitted endpoints retain saved dates, explicit null clears SQL NULL, and valid strings replace dates. Ordering is validated against resulting UTC calendar dates; null is never converted to 1970.

## D: first-administrator provisioning

Run migrations first. `npm.cmd run setup:first-admin` consumes JSON from standard input containing `full_name`, `email`, and an operator-supplied `password`. It does not accept password command-line arguments or print passwords/hashes. For example, in PowerShell:

```powershell
$operatorCredential = Get-Credential -UserName 'operator@example.edu'
@{
  full_name = 'Initial Administrator'
  email = $operatorCredential.UserName
  password = $operatorCredential.GetNetworkCredential().Password
} | ConvertTo-Json -Compress | npm.cmd run setup:first-admin
```

The command validates fields and bcrypt's UTF-8 byte limit, uses the normal bcrypt cost, and creates exactly one ACTIVE ADMIN in an installation with no user accounts. It creates no academic/sample data. Any existing administrator, including disabled accounts, prevents rerunning; existing non-admin accounts also prevent treating an installation as empty. An advisory lock and serializable transaction prevent concurrent first administrators. There is no unauthenticated HTTP provisioning endpoint.

Old historical migrations themselves contain placeholder academic rows. Provisioning neither creates nor deletes those pre-existing rows. The empty-installation integration test uses a freshly migrated disposable database with those placeholders removed solely in its test fixture, then authenticates the created operator and exercises initial department setup.

## E: major-owned cohort identities and reviewed legacy mapping

Create cohorts with `{major_id,generation_number,entry_academic_year_id,starting_year_level}`. The number is an integer from 1 through 2147483647, unique within one major. Numeric aliases `5`, `"5"`, `"05"`, and `"Gen 5"` normalize within that explicit major; arbitrary labels and ambiguous global resolution fail. `name` remains a compatibility display/legacy label, not cohort identity. Responses expose integer number, major ID, and major metadata. IDs remain distinct foreign keys and are never replaced by generation numbers.

Imports require request-level `major_id`, `generation_number` (or numeric legacy alias), academic placement, and students. Every row must resolve to that major. Validate all rows/majors before creating a cohort or student. Existing cohort entry metadata is reused only within that major. Mixed-major files require separate major/cohort/group batches. Existing-student skip/retry and per-student transaction behavior remain. Individual student creation verifies cohort ownership. Unchanged personal edits can retain a linked legacy cohort; automatic cohort reassignment is prohibited.

The additive migration leaves unscoped legacy cohorts readable and never guesses their ownership. New assignment to an unscoped cohort fails with `LEGACY_GENERATION_READ_ONLY`.

Run `npm.cmd run cohorts:preflight` against the intended configured database before deployment/mapping. It reports legacy labels, historical major contexts, entry metadata, references, duplicate assignment/evaluation identities, and case-insensitive course-code collisions. It includes a source fingerprint. Review the history, not just today's major.

To apply explicit ownership mapping:

```text
node scripts/cohort-migration.cjs --apply reviewed-cohort-plan.json
```

The plan must contain `approved:true`, `reviewed_by`, `rationale`, the current `source_fingerprint`, and complete mappings:

```json
{
  "approved": true,
  "reviewed_by": "Authorized operator",
  "rationale": "Reviewed original cohort ownership and all affected relations",
  "source_fingerprint": "<64 hexadecimal characters from preflight>",
  "mappings": [
    {
      "source_generation_id": "9",
      "target_major_id": "3",
      "generation_number": 1,
      "entry_academic_year_id": "7",
      "starting_year_level": 1,
      "student_ids": ["21"],
      "preserve_source_id": false
    },
    {
      "source_generation_id": "9",
      "target_major_id": "4",
      "generation_number": 1,
      "entry_academic_year_id": "8",
      "starting_year_level": 2,
      "student_ids": ["22"],
      "preserve_source_id": false
    }
  ]
}
```

All students in a reviewed source must be explicitly mapped once. No target collisions or silent merges are permitted. Shared/ambiguous cohorts receive new target IDs and retain the original as a read-only historical reference. Preserving a source ID requires one unambiguous major context and unchanged numeric/entry meaning. Snapshot/target/enrollment/response/answer relations are retained unchanged; used legacy offering scopes remain historical references rather than being silently rewritten. New teaching contexts must be reviewed separately. This deliberately requires explicit operational review before existing legacy classes are retargeted. The mapping audit/receipt is durable and retries return the original result.

## G, H, J: course creation and reviewed assignment/enrollment

`POST /courses` accepts omitted `course_code`; a department-prefixed unique code is allocated inside the creation transaction. Supply `idempotency_key` for lost-response recovery. Explicit official codes remain accepted and are never silently changed. Allocation includes occupied manual codes, sanitized-prefix collisions, and numbers beyond 999. The stored code is returned. Editing a name/department does not regenerate it. Case-insensitive conflicts return 409; a migration preflight blocks pre-existing collisions without renaming them.

New teaching assignments require an explicit approved student year and an applicable enabled curriculum revision in the selected semester's academic year, even with no group scopes. Every supplied major/year scope is validated. Future/withdrawn/untracked approvals cannot bypass this. Unchanged historical/pinned contexts retain their bindings; lecturer-only edits do not substitute today's approval.

Use `POST /course-offerings/create-preview` with `{rows:[<CreateCourseOfferingDto>,...]}` for 1–50 new assignment rows. Each row must contain explicit major/cohort/group scopes. Preview returns `items` with `row_index`, unique roster, count, and exact confirmed account IDs. It creates no offerings/enrollments.

Confirm at `POST /course-offerings/create-confirm` with unchanged `rows`, `review_id`, and `confirmations:[{row_index,confirmed_student_ids}]`. All rows, curriculum bindings, and reviewed enrollments commit together. Context/membership drift requires re-review. Retry the same review/body after an uncertain response; the durable receipt returns the same offering IDs.

Assignment identity is `(course_id,lecturer_id,semester_id,year_level,class_type)`. Class labels and group selections do not permit duplicates. Database guards enforce the stronger identity concurrently while preserving legacy duplicate history. `ASSIGNMENT_EXISTS` includes an authorized existing reference on normal duplicate validation. Existing separate CRUD and enrollment into an existing offering remain available, subject to the same integrity rules. Listing offerings includes persisted `_count.enrollments`, including zero; missing metadata must never be interpreted as zero by a client.

## L, M, N, O, Q: publication, deadlines, activity, and bulk reviews

For atomic single create/publication, include `publish:true` in the full creation preview and unchanged confirmation. An opaque review is mandatory for this action. A future start is valid; student access uses `start_at <= server time < end_at`. An elapsed deadline cannot create a published unusable evaluation. Existing drafts are not automatically published or reopened.

`PUT /evaluations/:id/schedule` supports active OPEN deadline extension using only a strictly later `end_at`. A supplied start, missing/equal/earlier deadline, upcoming/expired window, or CLOSED status is rejected. DRAFT scheduling retains its prior behavior. Changes and audit events share the serializable transaction; no questions, enrollment, participants, or answers are rewritten.

ADMIN-only `GET /evaluations/:id/activity?limit=20&cursor=...` returns immutable server-authored CREATED/SCHEDULED/DEADLINE_EXTENDED/CLOSED/SCHEDULE_UPDATED events with captured actor name, before/after schedule/status, stable string ID, ISO timestamp, and opaque keyset cursor. Ordering is timestamp descending then ID descending. Limits/cursors are bounded and every page is authorized. Completeness metadata distinguishes pre-logging history from an empty/new history. No historical actor/time is guessed. Failed transactions and successful retries produce no duplicate success events. Audit survives evaluation/account deletion; tombstoned evaluation history is restricted to installation-wide admins.

Exactly one new evaluation is allowed per course offering, regardless of questionnaire/version/status/schedule/audience. Existing duplicates across versions are retained and reported by preflight. Stronger database insertion guards prevent adding more without merging/deleting historical results. Normal duplicate conflicts use `EVALUATION_EXISTS` and authorized existing references; successful reviewed retries return their own original receipt.

Bulk endpoints implement the v1 shape in `improve.txt`:

- `POST /evaluations/bulk-create-preview` accepts 1–50 distinct `evaluations` rows with explicit course offering, named set, latest version, schedule, and `participant_scope:"ALL_ENROLLED"`. Extra audience restrictions are rejected. It returns one READY/SKIPPED/BLOCKED item per input, complete READY rosters, an opaque review, expiry, and `can_confirm`.
- Any existing evaluation is SKIPPED. Missing eligibility/enrollment, invalid approvals, and unavailable questions are BLOCKED. Confirmation requires at least one READY and no BLOCKED row.
- `POST /evaluations/bulk-create` accepts unchanged rows, review ID, and confirmations for exactly the READY assignments. One serializable transaction revalidates, creates independent evaluations/snapshots, publishes windows, locks versions, and writes audit events. Drift/concurrent duplicates return `REVIEW_INVALIDATED` with no batch writes; expiry returns `REVIEW_EXPIRED`.
- Success returns every input as SCHEDULED or SKIPPED with its evaluation ID. The actor/review/input-bound receipt survives preview expiry after successful confirmation. After an uncertain response, retry the same review/body; do not create a new batch or compensate by deleting records.

## Validation and release checks

Final local verification on 2026-10-17: **546/546 unit/controller tests in 46 suites and 498/498 API tests in 22 suites passed**. Full TypeScript checking, Nest build, CLI JavaScript syntax checks, and Git whitespace checking passed. Lint returned no errors and four existing warnings (two empty entity files and two unused test option variables). API tests used the dedicated local `teacher_evaluation_test_alignment` database; first-administrator tests used their separate disposable fixture. No existing installation was migrated by this verification.

PostgreSQL BIGINT IDs are bounded before new workflow queries. New payload arrays/row counts, idempotency keys, activity limits/cursors, group contexts, date windows, cohort numbers, versions, role/department scope, and exact confirmations are validated. Responses keep missing legacy metadata explicit.

The isolated test runner supports `TEST_DATABASE_SUFFIX` with a validated local `teacher_evaluation_test_<suffix>` name. Use the dedicated alignment database when the shared local test database has drifted beyond this checkout:

```powershell
npm.cmd run test:alignment:prepare
$env:TEST_DATABASE_SUFFIX = 'alignment'
npm.cmd run test:e2e:migrate
npm.cmd run test:e2e:seed
npm.cmd test -- --runInBand
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run lint
```

New coverage includes unit/controller contract checks, complete API workflows, SQL concurrency/integrity, empty installation provisioning/authentication, reviewed cohort splitting, no-write previews, late-write rollback for setup/assignment/bulk publication, idempotent replay, independent year/cohort copies, frozen audience aggregation across rating/choice/text, privacy projections, and scoped readers. Existing regression fixtures now use distinct real assignments rather than label-only duplicates or several evaluations per assignment.

No production migration, seeding, account reset, frontend implementation, or deployment is performed by these checks. Before deployment, back up the target and review preflight findings/mappings. Use migration deployment rather than schema push/reset; immutable history and retained legacy references are intentional.

## Requirement coverage and handoff

| Requirements | Backend delivery                                                                                                                          | Main verification                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A, K         | Shared-major/group unions, independent major restriction, immutable placements, list metadata, filtered anonymous aggregates/JSON exports | `test/backend-alignment.e2e-spec.ts`, existing targeting/results regressions                          |
| B, C         | Atomic year/semester setup, safe recovery/retries, retained/cleared/ordered dates                                                         | Alignment rollback tests, academic-integrity API tests, semester service tests                        |
| D            | First administrator CLI; no public setup account endpoint                                                                                 | `test/first-administrator.e2e-spec.ts` on a disposable database                                       |
| E            | Major-owned integer cohorts, scoped imports/assignment, reviewed legacy split tooling                                                     | Cohort utility units, import/student units, `test/cohort-migration.e2e-spec.ts`                       |
| F, I         | Independent student-group and teaching-assignment rollover with destination validation and provenance                                     | Alignment API rollover/recovery/rollback tests                                                        |
| G, H         | Automatic course codes and applicable curriculum-backed assignment years                                                                  | Code utility units, alignment and curriculum-revision API tests                                       |
| J            | No-write assignment preview, exact review, atomic offering/enrollment confirmation                                                        | Alignment workflow controller units and multi-row API rollback/retry tests                            |
| L, M, N      | Atomic reviewed publication, active deadline extension, immutable paginated activity                                                      | Alignment API tests, evaluation lifecycle units, existing reviewed-opening/window API tests           |
| O, P         | Assignment-only evaluation duplicates, label-independent assignment identity, enrollment counts, prerequisite errors                      | Alignment, course-offering, academic-integrity, and consistency API suites                            |
| Q            | Reviewed all-or-nothing bulk creation/publication with durable receipts                                                                   | Alignment tests for READY/SKIPPED/BLOCKED, late failure, roster drift, expiry, replay, changed access |
| R            | Authoritative year-specific self-profile, student class labels, report privacy projection                                                 | Auth units, student-access and alignment API tests                                                    |
| S            | Existing ownership and CLOSED-only lecturer release retained and documented                                                               | Existing dashboard/comment/results API tests; new filtered aggregate/export tests                     |

S's configurable response threshold and overlapping-small-cohort suppression remain **policy pending**, as specified in the requirements. No institution-approved threshold was supplied, so this delivery neither invents one nor claims those suppression cases have been implemented. Frontend adoption/browser acceptance and existing-installation migration review/deployment are separate remaining handoff work. Legacy ownership mappings must be reviewed against the real target's history before applying them.
