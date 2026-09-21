# Teacher Evaluation API — Backend Development Workflow

This README is a practical roadmap for completing the **Assessment / Teacher Evaluation System backend** step by step.

The goal is to avoid building everything at once.  
For each feature, follow the same cycle:

> **Understand → Build → Run → Test → Fix → Commit → Move to the next feature**

---

## 1. Project Goal

Build a backend API for a Teacher Evaluation / Assessment System using:

- NestJS
- TypeScript
- PostgreSQL
- Prisma
- Swagger / OpenAPI
- JWT Authentication
- Role-Based Access Control (RBAC)
- Jest / Supertest for testing

Main user roles:

- `ADMIN`
- `STUDENT`
- `LECTURER`

Main system flow:

```text
Admin prepares evaluation
        ↓
Student submits evaluation
        ↓
Lecturer views anonymous results
```

---

## 2. Current Development Strategy

Do **not** restart the project from zero.

Start from the current project structure provided by the professor:

```text
teacher-evaluation-api/
│
├── dist/
├── node_modules/
├── prisma/
├── src/
├── test/
│
├── .env
├── .env.example
├── .gitignore
├── .prettierrc
├── jest.config.ts
├── nest-cli.json
├── oxlint.json
├── package-lock.json
├── package.json
├── README.md
├── tsconfig.build.json
└── tsconfig.json
```

First:

```text
Current professor structure
        ↓
Understand what already exists
        ↓
Run project successfully
        ↓
Test existing API + database
        ↓
Fix confirmed errors
        ↓
Confirm architecture/conventions
        ↓
Continue feature development
```

---

## 3. Important Project Folders

### `src/`

Main backend source code.

```text
Controller
Service
DTO
Guards
Modules
Business logic
```

### `prisma/`

Database definition and migrations.

```text
schema.prisma
migrations/
seed.ts
```

### `test/`

Backend tests.

### `.env`

Environment configuration such as:

```env
DATABASE_URL=
JWT_SECRET=
PORT=
```

Do not commit sensitive `.env` values to GitHub.

### `package.json`

Contains:

- project dependencies
- scripts
- NestJS packages
- Prisma packages
- testing packages

Common commands:

```bash
npm install
npm run start:dev
npm run build
npm run lint
npm test
npm run test:e2e
```

---

# 4. Master Backend Roadmap

```text
CURRENT PROFESSOR STRUCTURE
        ↓
Understand existing code
        ↓
Run and test project
        ↓
Fix confirmed errors
        ↓
Confirm shared foundation
        ↓
────────────────────────────────
BUILD FEATURES ONE BY ONE
        ↓
1. Users Management
        ↓
2. Courses Management
        ↓
3. Semesters Management
        ↓
4. Course Offerings
        ↓
5. Enrollments
        ↓
6. Survey Management
        ↓
7. Survey Versions
        ↓
8. Questions
        ↓
9. Evaluations
        ↓
10. Student Access
        ↓
11. Submission
        ↓
12. Lecturer Dashboard
        ↓
13. Comments
        ↓
────────────────────────────────
Integration Testing
        ↓
Security / Privacy Testing
        ↓
Swagger Cleanup
        ↓
README / Documentation
        ↓
Supervisor Review
        ↓
FINAL BACKEND
        ↓
INTERNSHIP DEFENSE
```

---

# 5. Shared Backend Foundation

Before building many features, make sure the team agrees on:

```text
NestJS
PostgreSQL
Prisma
Swagger
JWT
RBAC
API naming
Error format
Git workflow
```

Roles:

```text
ADMIN
STUDENT
LECTURER
```

Both backend members should follow the same:

- naming convention
- route convention
- Prisma schema
- response format
- validation style
- Git workflow

---

# 6. Feature Development Workflow

Use the **same workflow for every feature**.

```text
FEATURE
  ↓
1. Understand requirement
  ↓
2. Check database model
  ↓
3. Check relationships
  ↓
4. Define API endpoints
  ↓
5. Create DTO validation
  ↓
6. Create Controller
  ↓
7. Create Service
  ↓
8. Use Prisma/PostgreSQL
  ↓
9. Add Auth / Role protection
  ↓
10. Add Swagger documentation
  ↓
11. Test success case
  ↓
12. Test failure cases
  ↓
13. Fix problems
  ↓
14. Commit
  ↓
NEXT FEATURE
```

Do **not** move to the next feature until the current feature is understandable and working.

---

# 7. Feature Roadmap

## Feature 1 — Users Management

Purpose:

- Manage system users
- Support `ADMIN`, `STUDENT`, and `LECTURER`
- Manage account status

Typical responsibilities:

```text
Create user
List users
Get user
Update user
Deactivate user
Validate role
Validate email
```

---

## Feature 2 — Courses Management

Purpose:

- Manage courses

Typical responsibilities:

```text
Create course
List courses
Get course
Update course
Validate unique course code
```

---

## Feature 3 — Semesters Management

Purpose:

- Manage academic semesters / academic years

Typical responsibilities:

```text
Create semester
List semesters
Update semester
Validate dates
```

---

## Feature 4 — Course Offerings

A course offering connects:

```text
Course
+
Lecturer
+
Semester
=
Course Offering
```

Purpose:

- Assign a lecturer to a course in a specific semester

---

## Feature 5 — Enrollments

An enrollment connects:

```text
Student
+
Course Offering
=
Enrollment
```

Purpose:

- Determine which students are allowed to evaluate a course

---

## Feature 6 — Survey Management

Purpose:

- Create and manage survey templates

Example:

```text
Teacher Evaluation Survey
```

---

## Feature 7 — Survey Versions

Purpose:

- Allow surveys to have versions
- Preserve historical questions

Example:

```text
Survey
   ↓
Version 1
Version 2
Version 3
```

---

## Feature 8 — Questions

Question types:

```text
RATING
TEXT
```

Example:

```text
Q1: The lecturer explains clearly.       → RATING
Q2: The course is well organized.        → RATING
Q3: Additional comments                  → TEXT
```

Rating example:

```text
1 2 3 4 5
```

Questions should be protected from editing after the related evaluation is opened.

---

## Feature 9 — Evaluations

An evaluation connects:

```text
Course Offering
+
Survey Version
+
Start Date
+
End Date
```

Lifecycle:

```text
DRAFT
  ↓
OPEN
  ↓
CLOSED
```

Meaning:

```text
DRAFT
Student cannot submit

OPEN
Student can submit

CLOSED
Student cannot submit
Lecturer can view results
```

---

## Feature 10 — Student Access

Student flow:

```text
Student Login
      ↓
Check enrollment
      ↓
Check evaluation status
      ↓
Check active time
      ↓
Check submission status
      ↓
Return available evaluation
```

Typical endpoints:

```text
GET available evaluations
GET evaluation survey
GET submission status
```

---

## Feature 11 — Submission

This is one of the most important backend features.

Flow:

```text
Student submits
      ↓
Check authentication
      ↓
Check enrollment
      ↓
Check evaluation is OPEN
      ↓
Check active date/time
      ↓
Check not already submitted
      ↓
Validate answers
      ↓
BEGIN TRANSACTION
      ↓
Mark participant as submitted
      ↓
Create anonymous response
      ↓
Create answers
      ↓
COMMIT
```

If something fails:

```text
ROLLBACK
```

The backend must prevent duplicate submissions.

---

# 8. Anonymous Response Design

Student identity should be separated from the response content.

Example:

```text
EvaluationParticipant
---------------------
studentId
evaluationId
hasSubmitted
```

Separate from:

```text
Response
--------
id
evaluationId
submittedAt
```

Do not directly store:

```text
studentId     ❌
participantId ❌
```

inside the anonymous response.

Goal:

```text
Backend knows:
"This student has submitted."

Backend should not expose:
"This anonymous response belongs to this student."
```

---

## Feature 12 — Lecturer Dashboard

Purpose:

Allow a lecturer to view only their own evaluation results.

Dashboard can include:

```text
Eligible student count
Response count
Response rate
Overall average
Average per question
Rating distribution
```

Authorization example:

```text
Lecturer A
   ↓
Evaluation of Lecturer A
   ✅ Allowed

Lecturer A
   ↓
Evaluation of Lecturer B
   ❌ Forbidden
```

---

## Feature 13 — Comments

Purpose:

- Return anonymous text feedback
- Do not expose student identity

Example:

```text
"Good explanation."

"The examples were useful."

"Please explain slower."
```

Lecturers must not receive:

```text
studentId
studentName
studentEmail
enrollmentId
participantId
```

---

# 9. Feature Dependency Flow

Later features depend on earlier ones.

```text
Users
  │
  ├───────────────┐
  ↓               ↓
Courses       Semesters
  └──────┬────────┘
         ↓
 Course Offerings
         ↓
    Enrollments


Surveys
   ↓
Survey Versions
   ↓
Questions


Course Offering + Survey Version
              ↓
          Evaluation
              ↓
       Student Access
              ↓
         Submission
              ↓
     Lecturer Dashboard
              ↓
           Comments
```

Because of these dependencies, avoid jumping directly to later features.

---

# 10. Definition of "Done"

A feature is **not done** only because the files were created.

A feature is done when:

```text
Code runs                ✅
Database works           ✅
Swagger works            ✅
Valid request works      ✅
Invalid request rejected ✅
Role permission works    ✅
Business rules work      ✅
Tests pass               ✅
Git commit created       ✅
```

---

# 11. Testing Strategy

For every feature, test both:

```text
Correct case ✅
Wrong case   ❌
```

Examples:

```text
Enrolled student      → ✅
Non-enrolled student  → ❌

OPEN evaluation       → ✅
CLOSED evaluation     → ❌

Rating = 5            → ✅
Rating = 6            → ❌

First submission      → ✅
Second submission     → ❌

Lecturer own result   → ✅
Other lecturer result → ❌
```

Useful commands:

```bash
npm run build
npm run lint
npm test
npm run test:e2e
```

---

# 12. Error Classification

When something is wrong, first decide what type of issue it is.

## ERROR

The implementation should work but fails.

Example:

```text
POST /login
→ server crashes
```

## MISSING FEATURE

The feature has not been implemented yet.

Example:

```text
SemestersModule does not exist yet.
```

## REQUIREMENT MISMATCH

The code works, but it does not match the agreed requirement.

Example:

```text
Current route:
/api/courses

Requirement:
/api/v1/admin/courses
```

Do not treat every mismatch as a code bug.

---

# 13. Git Workflow

Avoid doing all work directly on the main branch.

Example:

```bash
git checkout master
git pull

git checkout -b feat/users-management
```

After the feature is tested:

```bash
git add .
git commit -m "feat: implement users management"
git push origin feat/users-management
```

Then create a Pull Request for review.

Example feature branches:

```text
feat/users-management
feat/courses-management
feat/semesters-management
feat/course-offerings
feat/enrollments
feat/surveys
feat/survey-versions
feat/questions
feat/evaluations
feat/student-access
feat/submission
feat/lecturer-dashboard
feat/comments
```

---

# 14. Final Integration Test

After all individual features are complete, test the whole system as one flow.

```text
Admin Login
   ↓
Create Lecturer + Student
   ↓
Create Course
   ↓
Create Semester
   ↓
Create Course Offering
   ↓
Enroll Student
   ↓
Create Survey
   ↓
Create Survey Version
   ↓
Create Questions
   ↓
Create Evaluation
   ↓
Open Evaluation
   ↓
Student Login
   ↓
See Evaluation
   ↓
Submit Evaluation
   ↓
Try Submit Again
   ↓
❌ Reject duplicate
   ↓
Close Evaluation
   ↓
Lecturer Login
   ↓
View Dashboard
   ↓
View Anonymous Comments
```

If this complete scenario works correctly, the backend is properly integrated.

---

# 15. Swagger Testing

Swagger should be used throughout development.

Typical development flow:

```text
Swagger
   ↓
Controller
   ↓
DTO Validation
   ↓
Auth / Role Guard
   ↓
Service
   ↓
Prisma
   ↓
PostgreSQL
   ↓
Response
```

Use Swagger to test each endpoint immediately after implementing it.

---

# 16. Defense Notes

For every completed feature, keep a short note.

Example:

```text
Feature:
Courses Management

Purpose:
Admin manages courses.

Database:
courses

Endpoints:
POST
GET
PATCH

Important rule:
course_code must be unique.

Security:
ADMIN only.

Negative test:
Duplicate course code → rejected.

What I learned:
Controller → Service → Prisma → PostgreSQL.
```

This will make internship defense preparation much easier.

---

# 17. Main Rule for Development

Always follow:

```text
Understand
   ↓
Build
   ↓
Run
   ↓
Swagger Test
   ↓
Fix
   ↓
Test
   ↓
Commit
   ↓
Mark DONE
   ↓
Next Feature
```

Do not try to complete multiple features at the same time unless there is a clear dependency reason.

---

# 18. Current Starting Point

Before Feature 1, complete **Step 0**:

```text
Review current professor structure
        ↓
Understand existing project
        ↓
Run project successfully
        ↓
Test existing endpoints
        ↓
Check database connection
        ↓
Identify errors / missing features / requirement mismatches
        ↓
Fix confirmed problems
        ↓
Start Feature 1 — Users Management
```

---

## Backend Feature Checklist

- [ ] Step 0 — Review and stabilize current structure
- [ ] 1 — Users Management
- [ ] 2 — Courses Management
- [ ] 3 — Semesters Management
- [ ] 4 — Course Offerings
- [ ] 5 — Enrollments
- [ ] 6 — Survey Management
- [ ] 7 — Survey Versions
- [ ] 8 — Questions
- [ ] 9 — Evaluations
- [ ] 10 — Student Access
- [ ] 11 — Submission
- [ ] 12 — Lecturer Dashboard
- [ ] 13 — Comments
- [ ] Integration tests
- [ ] Security / privacy tests
- [ ] Swagger review
- [ ] README review
- [ ] Supervisor review
- [ ] Final backend ready
- [ ] Internship defense ready
