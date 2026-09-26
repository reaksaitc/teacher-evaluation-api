# Assessment System — Backend Requirements & Implementation Status

**Version 2.0 — all 13 features implemented and tested**

| Item | Value |
|---|---|
| Project | Assessment / Teaching Evaluation System (backend only) |
| Stack | NestJS, TypeScript, PostgreSQL, **Prisma**, JWT (Passport), Swagger |
| Roles | ADMIN, LECTURER, STUDENT |
| Status | Features 1–13 implemented; integration scenario passing |
| Automated tests | **14 e2e test suites, 234 tests, all passing** |
| Supersedes | v1.0 (proposal, 31 Aug 2026), v1.1–v1.3 (Courses/Auth review) |

---

## 1. Document history

| Version | Change |
|---|---|
| 1.0 | Original proposal: TypeORM, UUID keys, `/api/v1/admin/...` routes. |
| 1.1 | Audit of the forked codebase: Prisma, BigInt keys, real field names. |
| 1.2 | Auth reviewed; role guard applied to Courses and tested in Swagger. |
| 1.3 | First automated e2e suite (Courses + Auth). |
| **2.0** | **All 13 roadmap features built with guards, business rules, and e2e tests; full Admin → Student → Lecturer integration test.** |

---

## 2. Summary

The backend supports the complete evaluation flow:

```
Admin prepares      → Users, Courses, Semesters, Course Offerings, Enrollments,
                      Surveys, Survey Versions, Questions, Evaluations
Student submits     → Student Access, Submission (once, anonymously)
Lecturer views      → Lecturer Dashboard (aggregates), Comments (anonymous text)
```

The most safety-critical rules are enforced and tested:

- A student can evaluate only a class they are enrolled in, only while it is open, and **only once**, including two submissions sent at the same instant.
- Responses are **anonymous**: no student or participant id is stored with them, and timestamps are stored as dates only so participants and responses cannot be matched by time.
- A lecturer sees **only their own** evaluations, **only after closing**, and only aggregated numbers and anonymous comments.
- Questions **cannot change** once an evaluation using them has opened.

---

## 3. Technology stack (actual)

| Area | Used |
|---|---|
| Framework | NestJS |
| ORM | Prisma (`@prisma/client`) |
| Database | PostgreSQL |
| Auth | `@nestjs/jwt`, `@nestjs/passport`, `passport-jwt` |
| Password hashing | bcrypt (cost 10) |
| Validation | `class-validator`, `class-transformer`, global `ValidationPipe({ whitelist: true, transform: true })` |
| API docs | `@nestjs/swagger`, served at `/api/docs` |
| Tests | Jest + Supertest (e2e), run with `--experimental-vm-modules` (NestJS 12 packages are ESM-only) |

---

## 4. API conventions

| Convention | Rule |
|---|---|
| Base path | `/api` (not `/api/v1/admin` as proposed in v1.0) |
| Auth header | `Authorization: Bearer <JWT>` |
| IDs | PostgreSQL `BigInt`, **always returned and accepted as strings** (e.g. `"3"`) |
| Field names | `snake_case`, matching the database (`course_code`, `rating_value`) |
| Update method | `PUT` with partial bodies (v1.0 proposed `PATCH`) |
| State changes | Action routes, e.g. `POST /evaluations/:id/open`, `POST /surveys/:id/versions/:vid/archive` |
| Unknown fields | Silently removed by `whitelist: true` (e.g. `role` in a user update, `created_by` in a body) |
| Who did it | Always taken from the JWT (`@CurrentUser()`), never from the request body |
| Errors | NestJS standard shape: `{ statusCode, message, error }` |

**Status codes used consistently**

| Code | Meaning |
|---|---|
| 400 | Invalid input, or an id in the **body** that doesn't exist / breaks a rule |
| 401 | Missing or expired token |
| 403 | Wrong role, or not your resource (not enrolled, not your evaluation) |
| 404 | The resource in the **URL** doesn't exist |
| 409 | Conflicts with current state: duplicate, locked, not open, already submitted, in use |

---

## 5. Access by role

| Area | ADMIN | LECTURER | STUDENT |
|---|---|---|---|
| Login, `/auth/me` | ✅ | ✅ | ✅ |
| Courses, Semesters, Course Offerings (read) | ✅ | ✅ | ✅ |
| Courses, Semesters, Course Offerings (write) | ✅ | ❌ | ❌ |
| Users, Enrollments, Surveys, Versions, Questions, Evaluations | ✅ | ❌ | ❌ |
| Student Access, Submission | ❌ | ❌ | ✅ |
| Lecturer Dashboard, Comments | ❌ | ✅ (own only) | ❌ |

---

## 6. Project structure

```
src/
├── main.ts, app.module.ts, app.controller.ts, app.service.ts
├── prisma/                 PrismaService (shared DB access)
├── common/
│   ├── decorators/         @Roles(), @CurrentUser()
│   ├── guards/             RolesGuard
│   └── pipes/              ParseBigIntPipe
├── auth/                   login, JWT strategy, /me
├── users/                  Feature 1
├── courses/                Feature 2
├── semesters/              Feature 3
├── course-offerings/       Feature 4
├── enrollments/            Feature 5
├── surveys/                Feature 6
├── survey-versions/        Feature 7  (exports assertEditable)
├── questions/              Feature 8
├── evaluations/            Feature 9
├── student-access/         Feature 10 (exports getAnswerableEvaluation)
├── submissions/            Feature 11
├── lecturer-dashboard/     Feature 12 (exports getOwnClosedEvaluation)
└── comments/               Feature 13
test/
├── jest-e2e.json
└── 14 *.e2e-spec.ts files
```

Each feature module follows the same shape: `module`, `controller` (routes + guards), `service` (business rules + Prisma), `dto/` (validation).

---

## 7. Endpoints (53)

### Auth & health

| Method | Route | Role |
|---|---|---|
| POST | `/api/auth/login` | Public |
| GET | `/api/auth/me` | Any logged-in |
| GET | `/api/health` | Public |

### Feature 1 — Users (ADMIN)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/users?role=&status=` | Optional filters |
| GET | `/api/users/:id` | |
| POST | `/api/users` | Password hashed with bcrypt; email stored lowercase |
| PUT | `/api/users/:id` | Name, email, status, password. **Role cannot change.** |

No delete: accounts are **deactivated** (`status: INACTIVE`), which blocks login and existing tokens immediately. An admin cannot deactivate their own account. `password_hash` is never returned.

### Feature 2 — Courses · Feature 3 — Semesters · Feature 4 — Course Offerings

| Method | Route | Role |
|---|---|---|
| GET | `/api/{courses \| semesters \| course-offerings}` | Any logged-in |
| GET | `/api/{...}/:id` | Any logged-in |
| POST | `/api/{...}` | ADMIN |
| PUT | `/api/{...}/:id` | ADMIN |
| DELETE | `/api/{...}/:id` | ADMIN |

- Courses: `course_code` unique.
- Semesters: unique `(semester_name, academic_year)`; `end_date` after `start_date` (also on partial updates); cannot delete if used by offerings.
- Course Offerings: course and semester must exist; **`lecturer_id` must be a user with role LECTURER**; duplicate check done in code because PostgreSQL treats `NULL` section codes as all different; lecturer returned without `password_hash`; cannot delete if it has enrollments or evaluations.

### Feature 5 — Enrollments (ADMIN)

| Method | Route |
|---|---|
| GET | `/api/course-offerings/:offeringId/enrollments` |
| POST | `/api/course-offerings/:offeringId/enrollments` |
| DELETE | `/api/course-offerings/:offeringId/enrollments/:studentId` |

`student_id` must be a user with role STUDENT; one enrollment per student per offering. List is ADMIN-only because it contains student names and emails.

### Feature 6 — Surveys (ADMIN)

`GET`, `GET /:id`, `POST`, `PUT /:id`, `DELETE /:id` on `/api/surveys`. Creator taken from the token. Each survey is returned with a summary of its versions. Cannot delete a survey that has versions.

### Feature 7 — Survey Versions (ADMIN)

| Method | Route | Notes |
|---|---|---|
| GET | `/api/surveys/:surveyId/versions` | With question/evaluation counts |
| POST | `/api/surveys/:surveyId/versions` | Next number assigned automatically; optional `copy_questions: true` (transaction) |
| GET | `/api/surveys/:surveyId/versions/:versionId` | With questions; must belong to that survey |
| POST | `/api/surveys/:surveyId/versions/:versionId/archive` | Once only |
| DELETE | `/api/surveys/:surveyId/versions/:versionId` | Not if LOCKED or used by an evaluation |

### Feature 8 — Questions (ADMIN)

| Method | Route |
|---|---|
| GET | `/api/survey-versions/:versionId/questions` |
| POST | `/api/survey-versions/:versionId/questions` |
| PUT | `/api/questions/:questionId` |
| DELETE | `/api/questions/:questionId` |

- **Lock rule:** add/edit/delete only while the version is `DRAFT` **and** no evaluation using it has opened (otherwise `409`).
- RATING: range defaults to 1–5, must stay within 1–5, min < max. TEXT: no range allowed. Changing RATING → TEXT clears the range.
- `display_order` defaults to the end; unique within a version.

### Feature 9 — Evaluations (ADMIN)

| Method | Route | Allowed when |
|---|---|---|
| GET | `/api/evaluations?status=` | always |
| GET | `/api/evaluations/:id` | always |
| POST | `/api/evaluations` | always (creates `DRAFT`) |
| PUT | `/api/evaluations/:id/schedule` | DRAFT |
| POST | `/api/evaluations/:id/open` | DRAFT |
| POST | `/api/evaluations/:id/close` | OPEN |
| DELETE | `/api/evaluations/:id` | DRAFT |

**Opening** checks readiness (dates set, `end_at` in the future, version has questions and isn't archived, at least one enrolled student), then in **one transaction**: sets `OPEN`, **locks the survey version**, and creates one `evaluation_participants` row per enrolled student. Open/close use a conditional update so two simultaneous clicks cannot both succeed.

### Feature 10 — Student Access · Feature 11 — Submission (STUDENT)

| Method | Route |
|---|---|
| GET | `/api/student/evaluations` |
| GET | `/api/student/evaluations/:id/survey` |
| GET | `/api/student/evaluations/:id/submission-status` |
| POST | `/api/student/evaluations/:id/responses` |

A student may answer only if they are a participant **and still enrolled**, the evaluation is `OPEN`, now is within `start_at`–`end_at`, and they haven't submitted. Responses are mapped to clean objects with no internal ids.

**Submission** validates every answer first (question belongs to the version, no duplicates, RATING within its range, TEXT only for TEXT, required questions answered; empty optional comments skipped), then in **one transaction**: re-checks the evaluation is open, marks the participant submitted **only if not already** (race-safe), creates one anonymous `responses` row, and creates the `answers`.

### Feature 12 — Lecturer Dashboard · Feature 13 — Comments (LECTURER)

| Method | Route |
|---|---|
| GET | `/api/lecturer/evaluations` |
| GET | `/api/lecturer/evaluations/:id/dashboard` |
| GET | `/api/lecturer/evaluations/:id/comments` |

Access: `404` if missing → `403` if not the lecturer's own offering → `409` if not `CLOSED`.

Dashboard: eligible count, response count, response rate, overall average (all rating answers), and per RATING question the average and a full score distribution (computed with `groupBy` in the database). Comments: grouped by TEXT question, plain strings only, **sorted alphabetically** so order can't reveal who wrote what.

---

## 8. Business rules — how each is enforced and proven

| Rule | Enforcement | Proven by |
|---|---|---|
| BR01 Evaluate only enrolled courses | Participants created from enrollments at open; access check requires participant + current enrollment | `student-access`, `submissions` |
| BR02 Submit once | Conditional update `has_submitted: false → true` inside a transaction; unique `(evaluation_id, student_id)` | `submissions` (two simultaneous submissions → one `201`, one `409`) |
| BR03 Submit only while OPEN | Status + time window check, re-checked inside the transaction | `student-access`, `submissions` |
| BR04 Lecturer sees only own results | Ownership via `course_offerings.lecturer_id` | `lecturer-dashboard`, `comments` |
| BR05 Comments anonymous | No student link in `responses`/`answers`; comments returned as sorted plain text | `comments`, `integration` |
| BR06 Only admins edit questions | `@Roles('ADMIN')` + `RolesGuard` | `questions` |
| BR07 Only admins open/close | `@Roles('ADMIN')` | `evaluations` |
| BR08 Evaluation = course + lecturer + semester | Evaluation references a course offering; lecturer must have role LECTURER | `course-offerings`, `evaluations` |
| BR09 Questions locked after start | Version `LOCKED` on open; `assertEditable()` also rejects versions used by any non-draft evaluation | `questions`, `evaluations` |
| BR10 Closed accepts no responses | Same as BR03 | `submissions` |
| BR11 Ratings within range | Per-question min/max checked at submission; question ranges limited to 1–5 | `questions`, `submissions` |
| BR12 Dashboard shows aggregates only | Aggregated in the database; no identity fields in output | `lecturer-dashboard` |

---

## 9. Privacy and security measures

- `password_hash` excluded from every response by explicit `select` lists (users, offerings, enrollments, evaluations); tests assert it is absent.
- `responses` and `answers` contain no `student_id` or `participant_id`.
- Participant and response timestamps are stored as **dates only (midnight UTC)** to prevent matching them by exact time.
- Comments sorted alphabetically, never in submission order.
- Lecturer results only after the evaluation is `CLOSED`.
- Enrollment and user lists restricted to ADMIN.
- Login returns the same message for unknown email and wrong password.
- Deactivated users are rejected on every request (JWT strategy re-checks status).

---

## 10. Testing

Run all tests:

```bash
npx cross-env NODE_OPTIONS=--experimental-vm-modules jest --config ./test/jest-e2e.json
```

| Test file | Feature | Tests |
|---|---|---|
| `app.e2e-spec.ts` | Courses + Auth | 16 |
| `users.e2e-spec.ts` | Users | 19 |
| `semesters.e2e-spec.ts` | Semesters | 15 |
| `course-offerings.e2e-spec.ts` | Course Offerings | 19 |
| `enrollments.e2e-spec.ts` | Enrollments | 14 |
| `surveys.e2e-spec.ts` | Surveys | 16 |
| `survey-versions.e2e-spec.ts` | Survey Versions | 15 |
| `questions.e2e-spec.ts` | Questions | 21 |
| `evaluations.e2e-spec.ts` | Evaluations | 24 |
| `student-access.e2e-spec.ts` | Student Access | 15 |
| `submissions.e2e-spec.ts` | Submission | 20 |
| `lecturer-dashboard.e2e-spec.ts` | Lecturer Dashboard | 13 |
| `comments.e2e-spec.ts` | Comments | 11 |
| `integration.e2e-spec.ts` | Full Admin → Student → Lecturer flow | 16 |
| **Total** | | **234** |

Tests create their own temporary data and clean it up afterwards; seed data is only read (or changed and restored).

**Manual Swagger testing:** Features 1–5 were also tested by hand. Features 6–13 still need a manual pass.

---

## 11. Differences from the v1.0 proposal

| v1.0 proposed | Implemented | Reason |
|---|---|---|
| TypeORM | Prisma | Team's existing setup |
| UUID keys | BigInt auto-increment, returned as strings | Existing schema |
| `/api/v1/admin/...` | `/api/...` | Matches the existing Courses routes |
| `PATCH` for updates | `PUT` (partial body) | Consistency with existing code |
| Application error codes (`ALREADY_SUBMITTED`, `QUESTION_SET_LOCKED`, …) | Standard NestJS errors with clear messages | Not yet implemented |
| argon2 | bcrypt | Already installed and used by seed data |
| `forbidNonWhitelisted: true` | Unknown fields silently removed | Existing `main.ts` setting |
| Courses admin-only for reading | Any logged-in user can read courses, semesters, offerings | Practical: students/lecturers need course info |
| Enrollment status (ACTIVE/DROPPED) | Enrollments are deleted instead | No status column in the schema |
| `first_name` / `last_name`, `is_active` flags | `full_name`; no `is_active` columns | Existing schema |

---

## 12. Known limitations and follow-ups

| # | Item |
|---|---|
| 1 | No machine-readable error codes (v1.0 section 23); messages only. |
| 2 | Changing a password does not invalidate existing tokens (valid until expiry, default 1 day). Deactivation does take effect immediately. |
| 3 | No pagination on list endpoints. |
| 4 | Helmet, CORS policy, and rate limiting on login not yet configured (v1.0 SEC-10). |
| 5 | Database `CHECK` constraints (`end_at > start_at`, rating 1–5) not verified in migrations; rules are enforced in the services. |
| 6 | Seed data: survey version 1 is `DRAFT` although seeded evaluation 1 is `OPEN`. The lock rule still protects it (it checks evaluations too), but the seed should set it to `LOCKED`. |
| 7 | Seeded evaluation 1 has a fixed window (about two weeks after seeding); after that it disappears from students' lists while still `OPEN`. |
| 8 | Login email is matched exactly; new accounts are stored lowercase, so login should also lowercase the input. |
| 9 | Removing an enrollment after an evaluation opened keeps the participant row; the student is still blocked because access requires a current enrollment. |

---

## 13. Decisions for supervisor confirmation

| ID | Question | Current behaviour |
|---|---|---|
| OD-01 | How are accounts created? | Admin creates them via `/api/users`; no self-registration |
| OD-02 | Can lecturers see results while OPEN? | **No — only after CLOSED** (one-line change if needed) |
| OD-03 | Year level / major on the survey? | Not stored |
| OD-04 | Minimum responses before showing results? | None applied |
| OD-05 | Can a CLOSED evaluation reopen? | No |
| OD-06 | Department dashboard in v1? | Not built |
| OD-07 | Reuse one survey version across courses? | Allowed |
| OD-08 | Auto-close when `end_at` passes? | No; the time window blocks submissions, and an admin closes it |
| New | Route style `/api/...` vs `/api/v1/admin/...` | `/api/...` |
| New | Machine-readable error codes | Not implemented yet |

---

## 14. Running the project

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev          # API at http://localhost:3000/api, Swagger at /api/docs
```

Seed accounts (password `Password123`): `admin@itc.edu.kh` (ADMIN), `sokdara@itc.edu.kh` and `chanthy@itc.edu.kh` (LECTURER), `student1`–`student5@itc.edu.kh` (STUDENT).
