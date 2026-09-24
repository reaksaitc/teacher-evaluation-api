# Assessment / Teaching Evaluation System --- Backend

> **Backend status:** Complete and tested\
> **Stack:** NestJS · TypeScript · PostgreSQL · Prisma · JWT/Passport ·
> Swagger · Jest/Supertest\
> **Roles:** ADMIN · LECTURER · STUDENT

## 1. Project Overview

This backend manages a complete teaching evaluation workflow.

The system allows an **Admin** to prepare courses, enrollments, surveys,
questions, and evaluations. A **Student** can anonymously evaluate a
course they are eligible for, only once and only during the allowed
evaluation period. After the evaluation is closed, the **Lecturer** can
see aggregated rating results and anonymous written comments for their
own courses.

``` text
ADMIN
  │
  ├── Users
  ├── Courses
  ├── Semesters
  ├── Course Offerings
  ├── Enrollments
  ├── Surveys
  ├── Survey Versions
  ├── Questions
  └── Evaluations
          │
          ▼
       STUDENT
          │
          ├── View available evaluations
          ├── View survey questions
          └── Submit one anonymous response
                  │
                  ▼
               LECTURER
                  │
                  ├── View own evaluations
                  ├── View aggregate dashboard
                  └── View anonymous comments
```

------------------------------------------------------------------------

## 2. What We Completed

The backend was developed as **13 main features**.

  -----------------------------------------------------------------------
  \#                Feature           What it does      Status
  ----------------- ----------------- ----------------- -----------------
  1                 Users             Admin manages     ✅
                                      users and account 
                                      status            

  2                 Courses           Manage course     ✅
                                      information       

  3                 Semesters         Manage semester   ✅
                                      and academic-year 
                                      information       

  4                 Course Offerings  Connect course,   ✅
                                      semester,         
                                      lecturer, and     
                                      section           

  5                 Enrollments       Enroll students   ✅
                                      into course       
                                      offerings         

  6                 Surveys           Manage reusable   ✅
                                      survey templates  

  7                 Survey Versions   Version surveys   ✅
                                      and optionally    
                                      copy questions    

  8                 Questions         Manage RATING and ✅
                                      TEXT questions    

  9                 Evaluations       Create, schedule, ✅
                                      open, close, and  
                                      delete            
                                      evaluations       

  10                Student Access    Show evaluations  ✅
                                      and surveys       
                                      available to a    
                                      student           

  11                Submission        Validate and save ✅
                                      one anonymous     
                                      response          

  12                Lecturer          Show aggregate    ✅
                    Dashboard         evaluation        
                                      results           

  13                Comments          Show anonymous    ✅
                                      written feedback  
  -----------------------------------------------------------------------

All 13 features have been manually tested through Swagger, and the
automated e2e suite passes **234/234 tests across 14 test suites**.

------------------------------------------------------------------------

## 3. Technology Stack

  Area                Technology
  ------------------- -------------------------------------
  Backend framework   NestJS
  Language            TypeScript
  Database            PostgreSQL
  ORM                 Prisma
  Authentication      JWT + Passport
  Password hashing    bcrypt
  Validation          class-validator + class-transformer
  API documentation   Swagger
  Automated testing   Jest + Supertest

Swagger is available at:

``` text
http://localhost:3000/api/docs
```

The API base path is:

``` text
/api
```

------------------------------------------------------------------------

## 4. Roles and Permissions

### ADMIN

The Admin prepares and controls the evaluation process.

Admin can:

-   manage users;
-   manage courses and semesters;
-   create course offerings;
-   enroll students;
-   create surveys and survey versions;
-   create and edit questions;
-   create and schedule evaluations;
-   open and close evaluations.

### STUDENT

The Student participates in evaluations.

Student can:

-   see evaluations they are eligible to answer;
-   view the evaluation survey;
-   check submission status;
-   submit one response.

A student cannot submit if they are not eligible, the evaluation is
outside its allowed period, the evaluation is not open, or they already
submitted.

### LECTURER

The Lecturer views results for their own course offerings.

Lecturer can:

-   see their own evaluations;
-   view aggregate results after an evaluation is closed;
-   view anonymous written comments.

Lecturers do not receive student identities with evaluation responses.

------------------------------------------------------------------------

## 5. Main Evaluation Workflow

### Step 1 --- Admin prepares academic data

The Admin creates:

``` text
Users
  ↓
Courses + Semesters
  ↓
Course Offerings
  ↓
Enrollments
```

A course offering connects a course, semester, lecturer, and optional
section.

### Step 2 --- Admin prepares the survey

``` text
Survey
  ↓
Survey Version
  ↓
Questions
```

Two question types are supported:

-   **RATING** --- uses a numeric range, normally 1--5.
-   **TEXT** --- accepts written feedback.

Survey versions allow the question set to be controlled without changing
a version already being used by an evaluation.

### Step 3 --- Admin creates an evaluation

An evaluation connects:

``` text
Course Offering + Survey Version + Schedule
```

A new evaluation starts as:

``` text
DRAFT
```

While it is DRAFT, the schedule can still be changed.

### Step 4 --- Admin opens the evaluation

Before opening, the backend checks that the evaluation is ready.

When it opens, the backend performs the important changes in one
transaction:

``` text
Evaluation → OPEN
Survey Version → LOCKED
Enrolled Students → Evaluation Participants
```

Locking the survey version prevents questions from being changed after
an evaluation has started.

### Step 5 --- Student submits

The student can access an evaluation only when they are an eligible
participant, are still enrolled, the evaluation is OPEN, the current
time is within the evaluation window, and they have not already
submitted.

Before saving, the backend validates the answers, including:

-   the question belongs to the correct survey version;
-   the same question is not answered twice;
-   required questions are answered;
-   rating values are inside the allowed range;
-   TEXT answers are used only for TEXT questions.

Submission is protected against duplicate and simultaneous submissions.

### Step 6 --- Admin closes the evaluation

``` text
OPEN → CLOSED
```

After closing, new responses are no longer accepted.

### Step 7 --- Lecturer views results

Only after the evaluation is CLOSED can its lecturer view the results.

The dashboard provides:

-   eligible student count;
-   response count;
-   response rate;
-   overall rating average;
-   average for each rating question;
-   rating distributions;
-   anonymous written comments.

------------------------------------------------------------------------

## 6. Privacy and Anonymity

Protecting student anonymity is an important part of the implementation.

The system does **not** store a student or participant ID on the
response/answer records.

``` text
Student
   │
   ├── eligibility checked through participant record
   │
   └── submits
          ↓
       Response
          ↓
        Answers
          ✕ no student_id
          ✕ no participant_id
```

Additional protections include:

-   lecturers can access only their own evaluations;
-   results are available to lecturers only after the evaluation is
    closed;
-   lecturers receive aggregate statistics rather than student-level
    results;
-   written comments are returned as anonymous plain text;
-   comments are sorted rather than returned in submission order;
-   participant and response timestamps are stored as dates only to
    reduce the possibility of matching identities by exact submission
    time;
-   `password_hash` is excluded from API responses.

------------------------------------------------------------------------

## 7. Important Business Rules

  -----------------------------------------------------------------------
  Rule                                Behaviour
  ----------------------------------- -----------------------------------
  Student eligibility                 Student must be enrolled and an
                                      evaluation participant

  Submit once                         One submission per student per
                                      evaluation

  Evaluation period                   Submission is accepted only while
                                      the evaluation is OPEN and within
                                      its time window

  Question locking                    Questions cannot be changed after
                                      the evaluation opens

  Rating validation                   Ratings must be inside the
                                      question's configured range

  Lecturer ownership                  Lecturer can access only
                                      evaluations belonging to their own
                                      offering

  Lecturer result access              Results are available only after
                                      the evaluation is CLOSED

  Anonymous responses                 Responses and answers contain no
                                      student identity

  Admin control                       Survey/question/evaluation
                                      management is restricted to ADMIN

  Closed evaluation                   No new submissions are accepted
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 8. Project Structure

``` text
src/
├── main.ts
├── app.module.ts
├── app.controller.ts
├── app.service.ts
│
├── prisma/
│   └── PrismaService
│
├── common/
│   ├── decorators/
│   │   ├── @Roles()
│   │   └── @CurrentUser()
│   ├── guards/
│   │   └── RolesGuard
│   └── pipes/
│       └── ParseBigIntPipe
│
├── auth/
├── users/                 # Feature 1
├── courses/               # Feature 2
├── semesters/             # Feature 3
├── course-offerings/      # Feature 4
├── enrollments/           # Feature 5
├── surveys/               # Feature 6
├── survey-versions/       # Feature 7
├── questions/             # Feature 8
├── evaluations/           # Feature 9
├── student-access/        # Feature 10
├── submissions/           # Feature 11
├── lecturer-dashboard/    # Feature 12
└── comments/              # Feature 13

test/
├── jest-e2e.json
└── 14 *.e2e-spec.ts files
```

Each feature generally contains a module, controller, service, and DTOs.
Controllers handle routes and access control, services contain business
rules and Prisma operations, and DTOs validate incoming data.

------------------------------------------------------------------------

## 9. Main API Endpoints

### Authentication

  Method   Endpoint            Access
  -------- ------------------- ----------------
  POST     `/api/auth/login`   Public
  GET      `/api/auth/me`      Logged-in user
  GET      `/api/health`       Public

### Users

``` text
GET  /api/users
GET  /api/users/:id
POST /api/users
PUT  /api/users/:id
```

Users are deactivated instead of deleted. User roles cannot be changed
through the update endpoint.

### Courses / Semesters / Course Offerings

``` text
GET    /api/courses
POST   /api/courses
PUT    /api/courses/:id
DELETE /api/courses/:id

GET    /api/semesters
POST   /api/semesters
PUT    /api/semesters/:id
DELETE /api/semesters/:id

GET    /api/course-offerings
POST   /api/course-offerings
PUT    /api/course-offerings/:id
DELETE /api/course-offerings/:id
```

Logged-in users can read these resources; write operations are
restricted to ADMIN.

### Enrollments

``` text
GET    /api/course-offerings/:offeringId/enrollments
POST   /api/course-offerings/:offeringId/enrollments
DELETE /api/course-offerings/:offeringId/enrollments/:studentId
```

### Surveys

``` text
GET    /api/surveys
GET    /api/surveys/:id
POST   /api/surveys
PUT    /api/surveys/:id
DELETE /api/surveys/:id
```

### Survey Versions

``` text
GET    /api/surveys/:surveyId/versions
POST   /api/surveys/:surveyId/versions
GET    /api/surveys/:surveyId/versions/:versionId
POST   /api/surveys/:surveyId/versions/:versionId/archive
DELETE /api/surveys/:surveyId/versions/:versionId
```

### Questions

``` text
GET    /api/survey-versions/:versionId/questions
POST   /api/survey-versions/:versionId/questions
PUT    /api/questions/:questionId
DELETE /api/questions/:questionId
```

### Evaluations

``` text
GET    /api/evaluations
GET    /api/evaluations/:id
POST   /api/evaluations
PUT    /api/evaluations/:id/schedule
POST   /api/evaluations/:id/open
POST   /api/evaluations/:id/close
DELETE /api/evaluations/:id
```

### Student

``` text
GET  /api/student/evaluations
GET  /api/student/evaluations/:id/survey
GET  /api/student/evaluations/:id/submission-status
POST /api/student/evaluations/:id/responses
```

### Lecturer

``` text
GET /api/lecturer/evaluations
GET /api/lecturer/evaluations/:id/dashboard
GET /api/lecturer/evaluations/:id/comments
```

------------------------------------------------------------------------

## 10. API Conventions

-   Base path: `/api`
-   Authentication: `Authorization: Bearer <JWT>`
-   Database IDs use PostgreSQL `BigInt`.
-   IDs are accepted and returned as strings, for example `"3"`.
-   Database/API fields use `snake_case`.
-   Updates use `PUT` with partial request bodies.
-   The current user is taken from the JWT rather than trusted from the
    request body.
-   Unknown request fields are removed by the global validation pipe.

Common HTTP status codes:

  Code   Meaning
  ------ ----------------------------------------------------
  200    Successful request
  201    Resource created / response submitted
  204    Successful delete with no response body
  400    Invalid input
  401    Missing or invalid authentication
  403    Wrong role or resource does not belong to the user
  404    Requested resource does not exist
  409    Current state conflicts with the requested action

------------------------------------------------------------------------

## 11. Swagger Documentation

Swagger documents the backend endpoints and can also be used for manual
API testing.

Start the backend:

``` bash
npm run start:dev
```

Then open:

``` text
http://localhost:3000/api/docs
```

Swagger response documentation was reviewed across the controllers so
successful and important error responses are documented.

Manual Swagger testing has been completed for **Features 1--13**,
including the complete Admin → Student → Lecturer workflow.

------------------------------------------------------------------------

## 12. Automated Testing

The project contains **14 e2e test suites**.

  Test Suite                         Area                     Tests
  ---------------------------------- -------------------- ---------
  `app.e2e-spec.ts`                  Courses + Auth              16
  `users.e2e-spec.ts`                Users                       19
  `semesters.e2e-spec.ts`            Semesters                   15
  `course-offerings.e2e-spec.ts`     Course Offerings            19
  `enrollments.e2e-spec.ts`          Enrollments                 14
  `surveys.e2e-spec.ts`              Surveys                     16
  `survey-versions.e2e-spec.ts`      Survey Versions             15
  `questions.e2e-spec.ts`            Questions                   21
  `evaluations.e2e-spec.ts`          Evaluations                 24
  `student-access.e2e-spec.ts`       Student Access              15
  `submissions.e2e-spec.ts`          Submission                  20
  `lecturer-dashboard.e2e-spec.ts`   Lecturer Dashboard          13
  `comments.e2e-spec.ts`             Comments                    11
  `integration.e2e-spec.ts`          Full workflow               16
  **Total**                                                 **234**

Latest verified result:

``` text
Test Suites: 14 passed, 14 total
Tests:       234 passed, 234 total
Snapshots:   0 total
```

Run the complete test suite with:

``` bash
npx cross-env NODE_OPTIONS=--experimental-vm-modules jest --config ./test/jest-e2e.json
```

The `--experimental-vm-modules` option is required by the current
Jest/NestJS module setup.

------------------------------------------------------------------------

## 13. Setup and Run

### 1. Install dependencies

``` bash
npm install
```

### 2. Generate Prisma Client

``` bash
npx prisma generate
```

This step is important after installing dependencies or when the Prisma
schema/client needs regeneration.

### 3. Configure environment variables

Make sure the project's `.env` contains the required database and JWT
configuration.

### 4. Run Prisma migrations

``` bash
npx prisma migrate dev
```

### 5. Start the backend

``` bash
npm run start:dev
```

API:

``` text
http://localhost:3000/api
```

Swagger:

``` text
http://localhost:3000/api/docs
```

------------------------------------------------------------------------

## 14. Seed Accounts

Seed password:

``` text
Password123
```

  Role       Account
  ---------- -----------------------------------------------------
  ADMIN      `admin@itc.edu.kh`
  LECTURER   `sokdara@itc.edu.kh`
  LECTURER   `chanthy@itc.edu.kh`
  STUDENT    `student1@itc.edu.kh` through `student5@itc.edu.kh`

------------------------------------------------------------------------

## 15. Known Limitations / Future Improvements

The current backend is complete for the implemented scope, but these
items can be improved later:

1.  Add machine-readable application error codes.
2.  Invalidate existing JWTs immediately after password changes.
3.  Add pagination to list endpoints.
4.  Configure Helmet, a production CORS policy, and login rate limiting.
5.  Add or verify database-level `CHECK` constraints for rules currently
    enforced by services.
6.  Update seed survey version 1 to `LOCKED` when its seeded evaluation
    is `OPEN`.
7.  Improve the fixed evaluation window used by seed data.
8.  Normalize login email to lowercase before lookup.
9.  Consider how enrollment removal after an evaluation opens should be
    represented; currently the participant row remains but current
    enrollment is still required for student access.

------------------------------------------------------------------------

## 16. Differences From the Original Proposal

During implementation, some technical choices changed to match the
existing project.

  Original proposal            Current implementation
  ---------------------------- ---------------------------------
  TypeORM                      Prisma
  UUID IDs                     BigInt auto-increment IDs
  `/api/v1/admin/...`          `/api/...`
  PATCH updates                PUT with partial bodies
  argon2                       bcrypt
  Application error codes      Standard NestJS errors/messages
  Enrollment status            Enrollment row is removed
  `first_name` + `last_name`   `full_name`

These are implementation differences, not unfinished features.

------------------------------------------------------------------------

## 17. Final Backend Status

``` text
13/13 backend features implemented          ✅
13/13 features manually tested in Swagger  ✅
Swagger response documentation reviewed    ✅
NestJS production build                    ✅
Prisma Client generation                   ✅
14/14 e2e test suites passing              ✅
234/234 automated tests passing            ✅
```

The backend now supports the complete teaching evaluation lifecycle:

``` text
ADMIN prepares evaluation
        ↓
STUDENT submits anonymously
        ↓
ADMIN closes evaluation
        ↓
LECTURER views aggregate results
        + anonymous comments
```

The main backend implementation and verification work for the current
project scope is complete.
