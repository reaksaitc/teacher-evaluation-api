# Assessment / Teaching Evaluation System — Backend

For the latest backend implementation of `improve.txt` A–S, use the [backend alignment contracts](docs/BACKEND_ALIGNMENT_CONTRACTS.md). They document the new APIs, capabilities, migrations, privacy policy, and frontend handoff. These changes have been tested in an isolated database; they have not been deployed to an existing installation. Older database/test counts below describe the earlier delivery.

Latest verification (2026-10-17): **546 unit/controller tests and 498 API tests passed**, with TypeScript and build checks passing. Lint has no errors and four existing warnings. The existing CLOSED-only lecturer release rule remains; an institution-approved minimum-response/small-cohort policy is still pending.

For professor review and frontend handoff, read the [consolidated project report](docs/BACKEND_PROJECT_REPORT.md) or its [Word version](docs/BACKEND_PROJECT_REPORT.docx).

For frontend testing, start with the [handoff checklist and request examples](docs/BACKEND_PROJECT_REPORT.md#88-frontend-team-handoff-and-acceptance-checklist) and [isolated setup guide](TESTING.md#frontend-team-preview-from-the-github-repository). Clone the delivery commit identified by the project owner; the earlier `578c63f` baseline does not contain these improvements.

> **Backend status:** Review-bound confirmation, exact-result retries, older-version retention, version-update impact and approved repeat/transfer/pause/resume/yearly-group progression, academic-year curriculum revisions and retained global question-set titles and immutable historical target labels are implemented and tested. Frontend integration/cutover, official recovery evidence and school deployment remain pending. School deployment must use the reviewed target-specific migration procedure. Local normal and test are aligned through all 18 migrations after verified backup/restore/rehearsal. Another deployment target needs its own reviewed migration procedure. See [current requirements review](docs/BACKEND_PROJECT_REPORT.md#7-backend-improvement-requirements-and-delivery-status).
> **Approved local follow-up:** Lecturer results require CLOSED evaluations. Evaluated offerings retain course/lecturer/semester identity and their semesters retain academic-year identity. Primary-department protection retains other memberships. The new safeguards enforce one active academic year, globally unique literal questionnaire titles, nullable offering uniqueness, year-level bounds and ordered dates. Generation maximum and UTC calendar-date validation are documented in Swagger. Full regression passed 514 unit and 471 API tests. Both application databases have 28 application tables/199 columns; normal and test both have all 18 migrations. The earlier approved normal alignment passed 16 read-only API checks; normal records/schema/sequences were also preserved during this new implementation. Fresh backup/restore and rehearsal are complete: 160 PostgreSQL/API cases and 16 read-only copied-data GET checks passed, with original records preserved. The approved normal migration is complete: all original values/sequences/old migration records were preserved and 16 read-only normal checks passed. The owner authorized publication to master after final review. Use the delivery commit containing this report and record its SHA with git rev-parse HEAD; see report Sections 9.1 and 11.8-11.13.
> **Stack:** NestJS · TypeScript · PostgreSQL · Prisma · JWT/Passport · Swagger · Jest · ts-jest · Supertest  
> **Roles:** ADMIN · LECTURER · STUDENT  
> **API base path:** `/api`

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Roles and Permissions](#4-roles-and-permissions)
5. [Core Concepts](#5-core-concepts)
6. [Authentication and Security](#6-authentication-and-security)
7. [Academic and Student Management](#7-academic-and-student-management)
8. [Courses, Course Offerings and Enrollment](#8-courses-course-offerings-and-enrollment)
9. [Named Question Sets and Survey Versions](#9-named-question-sets-and-survey-versions)
10. [Evaluations and Participant Targeting](#10-evaluations-and-participant-targeting)
11. [Student Access and Evaluation History](#11-student-access-and-evaluation-history)
12. [Assessment Drafts](#12-assessment-drafts)
13. [Anonymous Submission](#13-anonymous-submission)
14. [Safe Question-Set Updates](#14-safe-question-set-updates)
15. [Lecturer Results and Comments](#15-lecturer-results-and-comments)
16. [Important Business Rules](#16-important-business-rules)
17. [Main End-to-End Workflow](#17-main-end-to-end-workflow)
18. [Project Structure](#18-project-structure)
19. [API Conventions](#19-api-conventions)
20. [Swagger Documentation](#20-swagger-documentation)
21. [Database and Prisma](#21-database-and-prisma)
22. [Backend Testing](#22-backend-testing)
23. [Setup and Run](#23-setup-and-run)
24. [Frontend Integration Notes](#24-frontend-integration-notes)
25. [Known Limitations and Future Improvements](#25-known-limitations-and-future-improvements)
26. [Differences From the Original Proposal](#26-differences-from-the-original-proposal)
27. [Current Backend Status](#27-current-backend-status)
28. [Quick Start](#28-quick-start)

---

# 1. Project Overview

This project is the backend API for an **Assessment / Teaching Evaluation System**.

The system manages the teaching-evaluation lifecycle from academic setup and student enrollment to evaluation assignment, student feedback, anonymous submission, and lecturer result viewing.

The backend supports three main roles:

- **ADMIN**
- **LECTURER**
- **STUDENT**

The system includes:

- user and authentication management;
- student profiles;
- student generations;
- student academic records;
- academic years and semesters;
- departments and majors;
- courses and course offerings;
- individual and group enrollment;
- named question sets;
- versioned questionnaires;
- question management;
- evaluation scheduling;
- evaluation participant targeting;
- student evaluation availability and history;
- server-side assessment drafts;
- anonymous final submissions;
- safe questionnaire-version reconciliation;
- student progress;
- student import/export;
- lecturer dashboards;
- anonymous comments;
- administrative and lecturer results.

The high-level lifecycle is:

```text
ADMIN
  |
  +--> Academic setup
  |
  +--> User / Student management
  |
  +--> Course Offering
  |
  +--> Enrollment
  |
  +--> Named Question Set
  |       |
  |       +--> Survey Version
  |               |
  |               +--> Questions
  |
  +--> Evaluation
          |
          +--> Participant targeting
          +--> Schedule
          +--> OPEN
                 |
                 v
              STUDENT
                 |
                 +--> View assigned evaluation
                 +--> Save draft
                 +--> Submit anonymously
                         |
                         v
                      ADMIN
                         |
                         +--> Close evaluation
                                  |
                                  v
                              LECTURER
                                  |
                                  +--> Dashboard
                                  +--> Results
                                  +--> Anonymous comments
```

---

# 2. System Architecture

The backend follows the standard NestJS modular architecture.

```text
Frontend
   |
   v
HTTP Request
   |
   v
Controller
   |
   +--> Authentication Guard
   +--> Roles Guard
   +--> DTO Validation
   |
   v
Service
   |
   +--> Business Rules
   +--> Eligibility Checks
   +--> State Validation
   +--> Transactions
   |
   v
Prisma ORM
   |
   v
PostgreSQL
```

## Controller

Controllers expose HTTP routes and receive requests.

## DTO

DTOs define and validate incoming request data.

## Service

Services contain the main business logic.

Important rules are enforced by the backend rather than relying only on frontend state.

## Prisma

Prisma provides database access, relations, queries, and transactions.

## PostgreSQL

PostgreSQL stores the persistent application data.

---

# 3. Technology Stack

| Area               | Technology                          |
| ------------------ | ----------------------------------- |
| Backend Framework  | NestJS                              |
| Language           | TypeScript                          |
| Database           | PostgreSQL                          |
| ORM                | Prisma                              |
| Authentication     | JWT + Passport                      |
| Password Hashing   | bcrypt                              |
| Validation         | class-validator + class-transformer |
| API Documentation  | Swagger                             |
| Testing            | Jest + ts-jest                      |
| HTTP / E2E Testing | Supertest                           |

API base path:

```text
/api
```

Swagger:

```text
http://localhost:3000/api/docs
```

---

# 4. Roles and Permissions

## ADMIN

The Admin manages the academic and evaluation workflow.

Typical responsibilities include:

- manage users;
- manage students;
- manage academic years;
- manage semesters;
- manage departments;
- manage majors;
- manage student generations;
- manage student academic records;
- manage courses;
- manage course offerings;
- manage enrollments;
- preview and confirm group enrollment;
- import/export students;
- reset user passwords;
- manage named question sets;
- manage survey versions;
- manage questions;
- create evaluations;
- preview eligible participants;
- confirm evaluation participants;
- schedule evaluations;
- open evaluations;
- close evaluations;
- safely apply newer questionnaire versions to eligible unfinished participants;
- monitor student progress;
- view administrative results.

## STUDENT

Students participate in evaluations assigned to them.

Students can:

- authenticate using their supported identifier/student code;
- view their own profile;
- change their own password;
- view available evaluations;
- view evaluation history;
- view the correct questionnaire version;
- save an assessment draft;
- reload their saved draft;
- submit one final anonymous response;
- check submission state.

A student cannot answer when:

- the account is inactive;
- the student is not enrolled in the course offering;
- the student is not an evaluation participant;
- the evaluation is not OPEN;
- the current time is outside the evaluation period;
- the student has already submitted.

## LECTURER

Lecturers can access evaluation information and protected results for their own course offerings.

Lecturer features include:

- viewing their own evaluations;
- viewing aggregate evaluation dashboards;
- viewing protected results after the required evaluation state;
- viewing rating statistics;
- viewing anonymous written comments.

Student identities are not attached to final response records.

---

# 5. Core Concepts

Several terms in this backend look similar but represent different concepts.

## 5.1 User vs Student

### User

A `User` represents authentication and identity information.

Examples include:

- account identity;
- password hash;
- role;
- account status;
- authentication version.

### Student

A `Student` represents the academic student profile linked to a user.

Conceptually:

```text
User
 |
 | 1 : 0..1
 v
Student Profile
```

This separation keeps authentication information independent from student-specific academic data.

---

## 5.2 Course vs Course Offering

### Course

A reusable subject definition.

Example:

```text
Machine Learning
```

### Course Offering

A specific delivery of a course.

It can connect:

```text
Course
  +
Semester
  +
Lecturer
  +
Year Level
  +
Class Type
  +
Section
```

Therefore:

```text
Course != Course Offering
```

---

## 5.3 Enrollment vs Evaluation Participant

### Enrollment

Enrollment means the student belongs to a course offering.

### Evaluation Participant

An evaluation participant is a student who is assigned to a particular evaluation.

Therefore:

```text
Enrollment
    !=
Evaluation Participant
```

A student normally needs both conditions to answer:

```text
Enrolled?
   +
Assigned as participant?
   =
Eligible for further evaluation checks
```

---

## 5.4 Survey vs Survey Version

### Survey

A stable named question set.

Example:

```text
Teaching Quality Evaluation
```

### Survey Version

A specific questionnaire snapshot.

Example:

```text
Teaching Quality Evaluation
  |
  +--> Version 1
  |
  +--> Version 2
```

Historical versions are preserved rather than modifying questions already used by evaluations.

---

## 5.5 Evaluation DRAFT vs Assessment Draft

These are unrelated concepts.

### Evaluation DRAFT

An administrative lifecycle state.

```text
DRAFT -> OPEN -> CLOSED
```

### Assessment Draft

A student's unfinished saved answers.

```text
Student answers
     |
     +--> Save Draft
     |
     +--> Continue Later
```

---

## 5.6 Assessment Draft vs Final Response

A draft is temporary and identifiable to the participant so the student can return to it.

A final response is the submitted anonymous evaluation data.

```text
Assessment Draft
     |
     | final submission
     v
Anonymous Response
```

---

## 5.7 Base Survey Version vs Effective Survey Version

An evaluation has a base survey version.

A participant may also have a participant-level survey version.

The effective questionnaire is conceptually:

```text
effective version =
participant.survey_version_id
        ??
evaluation.survey_version_id
```

The fallback supports historical records where participant-level version data may not exist.

---

# 6. Authentication and Security

## 6.1 Authentication

Authentication answers:

> Who is making this request?

The backend uses JWT authentication with Passport.

Conceptually:

```text
Identifier + Password
        |
        v
Resolve User
        |
        v
Verify Password
        |
        v
Account ACTIVE?
        |
        v
Issue JWT
```

Staff accounts can use the supported email-based identity.

Student authentication also supports the student's identifier/student code.

---

## 6.2 Authorization

Authorization answers:

> Is this authenticated user allowed to perform this action?

The backend uses role-based access control.

Roles:

```text
ADMIN
LECTURER
STUDENT
```

Protected controllers use JWT authentication and role guards.

Authorization is different from business eligibility.

For example, a STUDENT role may be allowed to call a student endpoint, but the backend still checks whether that specific student is enrolled and assigned to the requested evaluation.

---

## 6.3 Authentication Version

The backend supports an authentication version for JWT invalidation.

Example:

```text
User auth_version = 3

Login
  |
  v
JWT contains version 3

Password changes
  |
  v
Database auth_version = 4

Old JWT version = 3
Current DB version = 4

=> old JWT can be rejected
```

This helps invalidate existing sessions after security-sensitive password changes.

---

## 6.4 Password Management

The backend supports:

- self-service password change;
- administrative password reset.

Passwords are stored as hashes, not plaintext.

`password_hash` must never be returned in normal API responses.

---

## 6.5 User Status

User accounts have status such as:

```text
ACTIVE
INACTIVE
```

Inactive users are blocked where active status is required, including authentication and new student eligibility operations.

Disabling an account preserves historical records better than deleting records that may already be referenced.

---

# 7. Academic and Student Management

The improved backend contains a richer student academic model.

## 7.1 Academic Years

Academic years represent academic periods.

Semesters reference academic years.

```text
Academic Year
     |
     +--> Semester 1
     |
     +--> Semester 2
```

`start_year` may be used for academic calculations where available.

---

## 7.2 Departments and Majors

Departments represent broader academic organizational units.

Majors provide more specific academic programs.

Conceptually:

```text
Department
    |
    +--> Major
```

Student academic records can reference majors.

---

## 7.3 Student Generations

A student generation represents a cohort/intake.

Example:

```text
Generation 2023
```

Generation information can contribute to effective year-level calculation.

---

## 7.4 Student Academic Records

A student academic record stores a student's placement for a specific academic year.

It can include:

- year level;
- major;
- class group;
- academic year.

Example:

```text
Student A

2025-2026
  Year 3
  Major: Data Science
  Group: AMS1-A

2026-2027
  Year 4
  Major: Data Science
  Group: AMS1-A
```

This allows academic history to be preserved instead of overwriting the student's previous placement.

---

## 7.5 Student Management

The backend supports administrative student management including:

- create student profile;
- retrieve student information;
- update student information;
- academic filtering;
- pagination where implemented;
- account status handling;
- generation information;
- academic records.

---

## 7.6 Student Import

Student import supports bulk onboarding.

The backend validates imported information and handles invalid or conflicting records according to the import rules.

Important cases include:

- duplicate student code;
- duplicate identity/email where applicable;
- invalid academic references;
- invalid student data.

---

## 7.7 Student Export

Student export supports structured administrative extraction of student data.

Filters can be used where supported to export the required academic group.

---

## 7.8 Student Progress

Student progress represents evaluation assignment/completion information.

Conceptually:

```text
Assigned Evaluations = 5
Completed Evaluations = 3

Progress = 3 / 5
```

This is evaluation completion progress, not a percentage of questions answered inside one questionnaire.

---

# 8. Courses, Course Offerings and Enrollment

## 8.1 Courses

A course represents the reusable subject definition.

Courses can be associated with departments.

---

## 8.2 Course Offerings

A course offering represents an actual teaching instance.

The current model can include information such as:

- course;
- semester;
- lecturer;
- year level;
- section;
- class type.

Supported class-type values include:

```text
COURSE
TD
TP
```

---

## 8.3 Individual Enrollment

An eligible student can be enrolled into a course offering.

The backend checks the student before creating the enrollment.

Duplicate enrollment is not allowed.

---

## 8.4 Group Enrollment

The improved backend supports group enrollment through a preview-and-confirm pattern.

```text
Academic Filters
      |
      v
Preview Students
      |
      +--> Eligible
      +--> Already Enrolled
      +--> Other relevant state
      |
      v
Admin Reviews
      |
      v
Confirm
      |
      v
Resolve Again
      |
      v
Create Explicit Enrollment Rows
```

The important design is that academic filters are used to **select** students.

After confirmation, explicit enrollment rows are stored.

This means later profile changes do not silently rewrite historical course membership.

Duplicate protection is also applied when bulk enrollment is confirmed.

---

# 9. Named Question Sets and Survey Versions

## 9.1 Named Question Set

A survey represents a stable named questionnaire.

Example:

```text
Teaching Quality Evaluation
```

---

## 9.2 Survey Versions

A survey can contain multiple versions.

```text
Teaching Quality Evaluation
        |
        +--> v1
        |
        +--> v2
        |
        +--> v3
```

Survey versions allow the questionnaire to evolve while preserving historical evaluation context.

Version states include:

```text
DRAFT
LOCKED
ARCHIVED
```

### DRAFT

Editable version.

### LOCKED

Frozen version that should no longer be changed.

### ARCHIVED

Historical version that is not intended for normal new use.

---

## 9.3 Questions

Questions belong to survey versions.

Supported question behavior includes types such as:

```text
RATING
TEXT
AGREEMENT
FREQUENCY
MULTIPLE_CHOICE
CHECKBOX
```

Question information can include:

- English text;
- Khmer text;
- category;
- required state;
- rating bounds;
- display order;
- selectable options.

---

## 9.4 Question Ordering

Questions support controlled ordering.

Operations can include:

- inserting at a position;
- shifting later questions;
- deleting while maintaining order;
- explicit reordering.

---

## 9.5 Version Safety

A version that is already used in protected evaluation/participant/draft/response context must not be freely mutated.

The backend protects historical consistency rather than relying on the frontend to hide edit buttons.

---

# 10. Evaluations and Participant Targeting

An evaluation connects:

```text
Course Offering
      +
Survey Version
      +
Participant Scope
      +
Schedule
```

---

## 10.1 Evaluation Lifecycle

The main lifecycle is:

```text
DRAFT
  |
  v
OPEN
  |
  v
CLOSED
```

### DRAFT

The evaluation is being prepared.

### OPEN

Eligible participants can answer during the allowed time window.

### CLOSED

New submissions are no longer accepted.

---

## 10.2 Schedule Rules

Schedule changes are restricted by lifecycle state.

The backend protects evaluation state transitions so the frontend cannot bypass lifecycle rules.

---

## 10.3 Participant Scope

The backend supports participant scopes including:

```text
ALL_ENROLLED
SELECTED_GENERATIONS
```

### ALL_ENROLLED

The evaluation can target enrolled students according to the evaluation rules.

### SELECTED_GENERATIONS

The evaluation can target selected student generations while still applying eligibility requirements.

---

## 10.4 Eligible Student Preview

Before final participant assignment, the backend can preview eligible students.

Conceptually:

```text
Course Offering
      |
      v
Enrolled Students
      |
      +--> ACTIVE?
      +--> Student profile valid?
      +--> Target criteria match?
      +--> Generation match?
      +--> Other eligibility checks
      |
      v
Preview
```

The preview can help the frontend show why some students are eligible or ineligible.

---

## 10.5 Preview Before Confirm

Participant targeting follows the same safe pattern as group enrollment:

```text
Preview
   |
   v
Admin Reviews
   |
   v
Confirm
   |
   v
Backend Rechecks
   |
   v
Participant Rows
```

The backend remains the final authority when confirmation occurs.

---

## 10.6 Opening an Evaluation

Before an evaluation becomes OPEN, the backend verifies the required state.

Checks include the required schedule, questionnaire/version state, questions, and participant requirements.

When appropriate, the questionnaire version is locked to prevent unsafe editing.

---

# 11. Student Access and Evaluation History

Student access is controlled by backend eligibility logic.

A student is answerable only when the required conditions are true.

Conceptually:

```text
Authenticated STUDENT?
        |
        v
Participant?
        |
        v
Enrolled?
        |
        v
Evaluation OPEN?
        |
        v
Inside active time window?
        |
        v
Already submitted?
        |
        v
Return exact questionnaire
```

The effective survey version is determined from the participant context with evaluation fallback for historical data.

---

## 11.1 Available Evaluations

Available evaluations represent evaluations the student can answer according to the current access rules.

---

## 11.2 Evaluation History

Student history can represent states such as:

```text
Upcoming
Not Started
Completed
Closed
```

These display states are derived from evaluation status, schedule, and submission state.

They should not be confused with additional persisted evaluation lifecycle states.

---

# 12. Assessment Drafts

Students can save unfinished evaluation answers.

A draft is scoped to:

- the current student/participant;
- the evaluation;
- the exact effective survey version.

Conceptually:

```text
Student
   |
   v
Questionnaire v1
   |
   +--> Answer Q1
   +--> Answer Q2
   |
   v
Save Draft
   |
   v
Return Later
   |
   v
Reload same questionnaire context
```

Drafts are intentionally version-aware.

The backend must not silently reinterpret a saved draft using a different questionnaire version.

---

# 13. Anonymous Submission

Final submission is one of the most important protected workflows.

## 13.1 Submission Flow

```text
Student submits
      |
      v
Check access
      |
      v
Resolve effective survey version
      |
      v
Load exact questions
      |
      v
Validate answers
      |
      v
Begin transaction
      |
      +--> Recheck evaluation
      +--> Recheck participant
      +--> Recheck survey version
      +--> Ensure not already submitted
      |
      v
Mark participant submitted
      |
      v
Create anonymous response
      |
      v
Create answers / selected options
      |
      v
Delete saved draft
      |
      v
Commit
```

If the transaction fails, partial completion should not remain.

---

## 13.2 Answer Validation

Validation depends on question type.

Examples include:

### RATING

Value must be inside the configured numeric bounds.

### TEXT

Text response is stored for text-based questions.

### MULTIPLE_CHOICE

Exactly one valid option is expected.

### CHECKBOX

Selected options must belong to the question.

### Required Questions

Required questions cannot be omitted in a valid final submission.

---

## 13.3 Duplicate Submission Protection

A student can submit only once.

The backend performs checks before and during the transaction to protect against duplicate or simultaneous requests.

Conceptually:

```text
Request A ----\
               +--> only one may complete
Request B ----/
```

---

## 13.4 Privacy and Anonymity

Student identity is used to verify eligibility and completion.

Final response content is stored separately from the participant identity.

Conceptually:

```text
Student Identity
      |
      v
Evaluation Participant
      |
      +--> has_submitted
      +--> submitted_at

Separate:

Anonymous Response
      |
      +--> Answers
      +--> Selected Options
```

The final response does not directly store:

```text
student_id
participant_id
```

This separation is important for privacy.

---

# 14. Safe Question-Set Updates

A difficult requirement is handling a newer questionnaire version when an evaluation already has unfinished participants.

The desired behavior is:

```text
New version of SAME named survey
               |
               v
        Participant State
        /       |        \
       /        |         \
Submitted   Has Draft   Untouched
   |           |            |
   v           v            v
Keep Old    Keep Old     May Move
Version     Version      to New Version
```

---

## 14.1 Submitted Participants

Completed participants remain connected to their original questionnaire context.

Their historical response must not be reinterpreted using a new version.

---

## 14.2 Participants With Drafts

An unfinished participant who already has a saved draft remains on the old version.

The backend does not:

- delete the draft;
- silently convert the draft;
- reinterpret answer IDs;
- move the participant to an incompatible version.

---

## 14.3 Untouched Unfinished Participants

An unfinished participant with no draft can safely be moved to the newer version of the **same named survey**, subject to backend checks.

---

## 14.4 Evaluation Base Version

Applying a newer version to eligible unfinished participants does **not** globally rewrite:

```text
evaluation.survey_version_id
```

Instead, participant-level survey-version context controls the effective questionnaire.

This preserves the evaluation's original base context.

---

## 14.5 Apply-to-Unfinished Operation

The administrative reconciliation operation:

1. verifies the target version belongs to the same survey;
2. verifies the target is DRAFT;
3. verifies the target contains questions;
4. finds relevant unfinished participants;
5. skips submitted participants;
6. skips participants with saved drafts;
7. skips participants already on the target version;
8. updates only safe unfinished participants;
9. locks the target version.

This is a backend business rule, not only a frontend behavior.

---

# 15. Lecturer Results and Comments

Lecturer result functionality is protected by lecturer ownership and evaluation state rules.

Lecturers can access their own evaluation information and aggregate results according to the backend's result-access rules.

Result information can include:

- eligible participant count;
- response count;
- response rate;
- rating averages;
- rating distributions;
- anonymous written comments.

Example:

```text
Eligible Students: 30
Responses:         27
Response Rate:     90%

Overall Average:   4.2 / 5
```

The lecturer should not receive student identity attached to final response content.

---

# 16. Important Business Rules

| Rule                    | Backend Behaviour                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Active account          | Operations requiring an active user reject inactive accounts                       |
| Enrollment eligibility  | New enrollment requires a valid eligible student                                   |
| Duplicate enrollment    | Same student cannot be enrolled twice in the same offering                         |
| Group enrollment        | Preview is reviewed before explicit enrollment rows are confirmed                  |
| Evaluation lifecycle    | Main lifecycle is DRAFT → OPEN → CLOSED                                            |
| Schedule editing        | Protected according to evaluation lifecycle                                        |
| Participant eligibility | Student must satisfy enrollment and participant rules                              |
| Evaluation time         | Answering is allowed only during the permitted evaluation window                   |
| Submit once             | One final submission per participant/evaluation                                    |
| Effective version       | Student questionnaire uses participant version with historical evaluation fallback |
| Draft version safety    | Saved drafts remain tied to their exact questionnaire version                      |
| Completed history       | Completed responses keep their original version                                    |
| Pending version update  | Only safe unfinished/no-draft participants may move                                |
| Question locking        | Used/protected questionnaire versions cannot be freely mutated                     |
| Required answers        | Required questions must be answered                                                |
| Rating bounds           | Rating must be within configured bounds                                            |
| Option validation       | Submitted option IDs must belong to the correct question                           |
| Anonymous response      | Final response content does not directly store student identity                    |
| Transaction safety      | Final submission operations succeed or fail together                               |
| Lecturer ownership      | Lecturer access is restricted to permitted own-course/evaluation data              |
| Admin control           | Administrative operations require appropriate authorization                        |

---

# 17. Main End-to-End Workflow

A complete system scenario can be understood as follows.

## Step 1 — Academic Setup

Admin prepares:

```text
Academic Year
Semester
Department
Major
Generation
```

## Step 2 — Student Setup

```text
User Account
     |
     v
Student Profile
     |
     v
Student Academic Record
```

## Step 3 — Course Setup

```text
Course
  |
  v
Course Offering
```

## Step 4 — Enrollment

```text
Select Academic Group
      |
      v
Preview
      |
      v
Confirm
      |
      v
Explicit Enrollments
```

## Step 5 — Question Set

```text
Named Survey
    |
    v
Survey Version
    |
    v
Questions
```

## Step 6 — Evaluation

```text
Course Offering
      +
Survey Version
      +
Participant Scope
      +
Schedule
      |
      v
Preview Eligible Students
      |
      v
Confirm Participants
      |
      v
OPEN
```

## Step 7 — Student Participation

```text
Student Login
      |
      v
Available Evaluations
      |
      v
Questionnaire
      |
      +--> Save Draft
      |
      v
Final Submit
```

## Step 8 — Backend Finalization

```text
Validate
   |
   v
Transaction
   |
   +--> Mark participant complete
   +--> Store anonymous response
   +--> Store answers
   +--> Remove draft
```

## Step 9 — Results

```text
Evaluation Closed
       |
       v
Lecturer
       |
       +--> Dashboard
       +--> Results
       +--> Anonymous Comments
```

---

# 18. Project Structure

The backend follows a modular NestJS structure.

A simplified structure is:

```text
teacher-evaluation-api/
|
+-- prisma/
|   +-- schema.prisma
|   +-- migrations/
|   +-- seed.ts
|
+-- src/
|   +-- auth/
|   +-- users/
|   +-- students/
|   +-- student-generations/
|   +-- student-academic-records/
|   +-- academic-years/
|   +-- departments/
|   +-- majors/
|   +-- courses/
|   +-- semesters/
|   +-- course-offerings/
|   +-- enrollments/
|   +-- surveys/
|   +-- survey-versions/
|   +-- questions/
|   +-- evaluations/
|   +-- student-access/
|   +-- assessment-drafts/
|   +-- submissions/
|   +-- student-progress/
|   +-- student-import/
|   +-- student-export/
|   +-- lecturer-dashboard/
|   +-- comments/
|   +-- results/
|   +-- common/
|   +-- prisma/
|   +-- main.ts
|   +-- app.module.ts
|
+-- test/
|
+-- package.json
+-- tsconfig.json
+-- tsconfig.spec.json
+-- jest.config.ts
+-- README.md
```

A normal feature module generally follows:

```text
feature/
|
+-- dto/
+-- feature.controller.ts
+-- feature.service.ts
+-- feature.module.ts
```

Some modules also contain targeted service/controller tests.

---

# 19. API Conventions

General conventions include:

- API base path: `/api`;
- JWT Bearer authentication;
- PostgreSQL `BigInt` IDs;
- JSON-safe ID serialization where required;
- DTO validation;
- global request validation;
- role-based guards;
- service-level business rules.

Authenticated requests use:

```text
Authorization: Bearer <JWT>
```

Common HTTP status categories:

| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| 200    | Successful request                                   |
| 201    | Resource created / operation completed               |
| 204    | Successful operation with no response body           |
| 400    | Invalid input or invalid request setup               |
| 401    | Missing, expired, revoked, or invalid authentication |
| 403    | Authenticated but not permitted/eligible             |
| 404    | Requested resource does not exist                    |
| 409    | Request conflicts with the current resource/state    |

Swagger is the preferred source for the exact current endpoint and DTO contract.

---

# 20. Swagger Documentation

Start the backend:

```bash
npm run start:dev
```

Open:

```text
http://localhost:3000/api/docs
```

Swagger can be used to:

- inspect routes;
- inspect DTOs;
- understand required fields;
- inspect response structures;
- authenticate with JWT;
- manually test API behavior;
- inspect status codes;
- demonstrate the backend during review/defense.

Swagger and automated testing have different purposes:

```text
Swagger
   |
   v
Manual API verification

        +

Jest / Supertest
   |
   v
Automated verification
```

---

# 21. Database and Prisma

The backend uses PostgreSQL with Prisma ORM.

Important conceptual relationships include:

```text
User
 |
 +--> Student Profile
 |
 +--> Role / Authentication

Student
 |
 +--> Generation
 +--> Academic Records

Academic Year
 |
 +--> Semesters

Department
 |
 +--> Majors
 +--> Courses

Course
 |
 +--> Course Offerings

Course Offering
 |
 +--> Enrollments
 +--> Evaluations

Survey
 |
 +--> Survey Versions
        |
        +--> Questions
              |
              +--> Options

Evaluation
 |
 +--> Evaluation Participants

Evaluation Participant
 |
 +--> Effective Survey Version
 +--> Assessment Draft
 +--> Submission State

Anonymous Response
 |
 +--> Survey Version
 +--> Answers
        |
        +--> Selected Options
```

## Important ID Naming Note

Some database fields named `student_id` refer to the student's **user account ID**, while `students.id` represents the student-profile record.

This convention should be understood carefully when integrating frontend/backend code.

A future redesign could use a more explicit name such as:

```text
student_user_id
```

However, this is not a reason to perform a risky schema migration during final integration testing.

---

## Prisma Migrations

The project uses Prisma migrations to evolve the database safely.

After pulling schema/migration changes:

```bash
npx prisma generate
```

Check migration state when needed:

```bash
npx prisma migrate status
```

For frontend evaluation, use `npm.cmd run test:e2e:migrate` with the guarded local test configuration. For any normal deployment, follow the reviewed audit/backup/approval procedure in Section 23.5 and the consolidated report. Supplied SQL-owned protections must remain in the migration chain.

Do not manually remove historical migration folders that are already part of the applied migration chain.

---

# 22. Backend Testing

Testing protects the backend against regression when business rules change.

The project uses:

```text
Jest
ts-jest
Supertest
Prisma
PostgreSQL
```

The Jest configuration is ESM-compatible.

---

## 22.1 Unit / Service Testing

Targeted tests verify individual controllers/services and business rules.

Examples of heavily tested areas include:

- users;
- students;
- student import;
- student export;
- student progress;
- course offerings;
- enrollments;
- evaluations;
- student access;
- assessment drafts;
- submissions;
- survey versions.

Mocks are used where appropriate to isolate service behavior.

---

## 22.2 Integration and E2E Testing

Integration/E2E tests exercise larger application flows.

Conceptually:

```text
HTTP Request
     |
     v
Controller
     |
     v
Validation / Guards
     |
     v
Service
     |
     v
Prisma
     |
     v
PostgreSQL
     |
     v
HTTP Response
```

---

## 22.3 Latest Regression Checkpoint

Latest full regression checkpoint for the current improvement implementation:

```text
Unit: 43 suites / 514 tests passed
API:  19 suites / 471 tests passed
Failed/pending: 0
```

TypeScript validation also passed:

```bash
npx tsc --noEmit
```

This checkpoint covers the current backend improvement implementation.

---

## 22.4 Important Targeted Test Results

Important targeted regression results during the improvement work included:

```text
Student Import              16 / 16 passed
Student Progress            13 / 13 passed
Student Export              24 / 24 passed
Evaluations Service         36 / 36 passed
Student Access              14 / 14 passed
Assessment Drafts           19 / 19 passed
Submissions                 23 / 23 passed
Survey Versions             26 / 26 passed
```

These targeted suites were used while implementing the corresponding business rules.

---

## 22.5 Running Tests

Run the complete Jest suite:

```bash
npm test -- --runInBand
```

Run a targeted test through the project's npm test script:

```bash
npm test -- src/evaluations/evaluations.service.spec.ts --runInBand
```

Do not bypass the project's configured ESM test runner with a direct plain `npx jest` command.

Run E2E tests:

```bash
npm run test:e2e
```

Run coverage:

```bash
npm run test:cov
```

Run the production build:

```bash
npm run build
```

Type-check without emitting files:

```bash
npx tsc --noEmit
```

---

## 22.6 Recommended Development Verification

For an important backend change:

```text
1. Modify code
      |
      v
2. Run targeted test
      |
      v
3. Fix real failures
      |
      v
4. Run TypeScript check
      |
      v
5. Run full regression
      |
      v
6. Run build
      |
      v
7. Review Git diff
      |
      v
8. Commit
      |
      v
9. Push
```

---

# 23. Setup and Run

## 23.1 Clone Repository

```bash
git clone <repository-url>
cd teacher-evaluation-api
```

---

## 23.2 Install Dependencies

The recorded evaluation used Node.js 24.16.0 and PostgreSQL 18.4. Supplied migrations require PostgreSQL 15 or newer for NULLS NOT DISTINCT; other compatible runtime/server versions have not been evaluated here. Use the lockfile for repeatable installation:

```bash
npm ci
```

---

## 23.3 Environment Variables

For frontend preview and synthetic testing, follow [the guarded setup](TESTING.md#frontend-team-preview-from-the-github-repository), using `.env.test.local` and `teacher_evaluation_test`. The following `.env` instructions describe the normal backend connection; do not use that database for synthetic testing.

Typical configuration includes:

```env
DATABASE_URL="postgresql://..."
JWT_SECRET="..."
FRONTEND_ORIGIN=http://localhost:5173
```

Use the real environment values provided by the team.

Never commit private production secrets.

---

## 23.4 Generate Prisma Client

```bash
npx prisma generate
```

---

## 23.5 Check / Apply Migrations

Check:

```bash
npx prisma migrate status
```

For the isolated frontend preview, deploy supplied migrations with `npm.cmd run test:e2e:migrate`. For a normal database, review the target, audit existing records, verify a restorable backup and approve its migration plan before applying:

```bash
npx prisma migrate deploy
```

Do not use `migrate dev`, `db push` or reset commands to align a populated school database. SQL-owned indexes, checks and history guards must be preserved through the supplied migrations.

---

## 23.6 Seed Development Data

For frontend evaluation, use the guarded synthetic seed:

```powershell
npm.cmd run test:e2e:seed
```

This validates `.env.test.local` and targets local `teacher_evaluation_test`. It restores synthetic account passwords, so coordinate with other testers. Do not run the general Prisma seed against the normal database.

---

## 23.7 Start Development Server

```bash
npm run start:dev
```

API:

```text
http://localhost:3000/api
```

Swagger:

```text
http://localhost:3000/api/docs
```

---

## 23.8 Verify Environment

Recommended checks:

```bash
npx prisma generate
npx prisma migrate status
npx tsc --noEmit
npm test -- --runInBand
npm run build
```

Use `npm run test:e2e` when the E2E test environment/database is configured.

---

# 24. Frontend Integration Notes

The frontend should treat the backend as the final authority for eligibility and lifecycle rules.

Do not rely only on frontend button visibility.

For example:

```text
Frontend hides "Submit"
        !=
Security rule
```

The backend must still reject an invalid submission.

---

## Important Concepts for Frontend Developers

```text
User
  !=
Student Profile

Course
  !=
Course Offering

Enrollment
  !=
Evaluation Participant

Survey
  !=
Survey Version

Evaluation DRAFT
  !=
Assessment Draft

Evaluation Base Version
  !=
Participant Effective Version

Assessment Draft
  !=
Final Response
```

---

## Recommended Frontend Test Scenarios

### Authentication

Test:

- admin login;
- lecturer login;
- student-code login;
- wrong password;
- inactive account;
- password change;
- old JWT after password change.

### Student Management

Test:

- create student;
- create/update academic record;
- generation;
- major;
- academic filters;
- inactive student behavior;
- import;
- export;
- progress.

### Enrollment

Test:

- individual enrollment;
- group preview;
- group confirmation;
- already-enrolled students;
- duplicate enrollment;
- student becoming invalid between preview and confirmation.

### Evaluation

Test:

- create DRAFT;
- set schedule;
- preview participants;
- confirm participants;
- open;
- attempt invalid schedule modification;
- close.

### Student Access

Test:

- assigned/enrolled student;
- enrolled but not participant;
- participant but invalid enrollment;
- before start;
- during active window;
- after end;
- closed evaluation;
- already submitted.

### Draft

Test:

- save draft;
- reload draft;
- update draft;
- invalid answer;
- questionnaire-version mismatch;
- failed final submission preserves draft.

### Final Submission

Test:

- valid submission;
- missing required answer;
- out-of-range rating;
- invalid option;
- duplicate question answer;
- invalid multiple-choice selection;
- duplicate final submission;
- simultaneous duplicate requests.

### Question-Set Update

Prepare three students:

```text
Student A -> already submitted
Student B -> has saved draft
Student C -> untouched
```

Apply a newer version of the same named question set.

Expected:

```text
Student A -> stays on old version
Student B -> stays on old version
Student C -> moves to new version
```

This is an important integration and defense scenario.

---

# 25. Known Limitations and Future Improvements

The current backend is suitable for final frontend integration and internship evaluation.

Future improvements can include:

1. administrative audit logging;
2. additional production security hardening;
3. login rate limiting;
4. expanded HTTP-level integration/E2E coverage;
5. automated CI/CD testing;
6. performance/load testing;
7. structured production monitoring/logging;
8. machine-readable application error codes;
9. formal API versioning if future releases require breaking changes;
10. additional database constraints where they provide value beyond service-level validation.

These are future enhancements and do not require a large pre-defense database redesign.

---

# 26. Differences From the Original Proposal

Some implementation choices evolved during development.

| Earlier / Original Direction     | Current Implementation                                        |
| -------------------------------- | ------------------------------------------------------------- |
| TypeORM                          | Prisma                                                        |
| UUID-oriented design             | BigInt auto-increment IDs                                     |
| `/api/v1/admin/...` style        | `/api/...`                                                    |
| PATCH-oriented updates           | PUT used where implemented                                    |
| argon2                           | bcrypt                                                        |
| Application-specific error codes | Standard NestJS HTTP exceptions/messages                      |
| Simpler student representation   | User + Student Profile + Academic Records                     |
| Basic reusable survey            | Named Survey + Survey Versions                                |
| Simple enrollment                | Individual + preview/confirm group enrollment                 |
| Basic evaluation assignment      | Participant scope + eligibility preview/confirmation          |
| Simple submission                | Draft-aware, version-aware transactional anonymous submission |

These are implementation decisions made as the actual backend architecture evolved.

---

# 27. Current Backend Status

## Original Core Scope

The original teaching-evaluation backend lifecycle is implemented.

This includes:

```text
Users
Courses
Semesters
Course Offerings
Enrollments
Surveys
Survey Versions
Questions
Evaluations
Student Access
Submission
Lecturer Dashboard
Anonymous Comments
```

---

## Completed Improvement Areas

```text
Majors                                      ✅
Student Generations                         ✅
Student Profiles                            ✅
Student Academic Records                    ✅
Academic-year improvements                  ✅
Course year/effective-level rules           ✅
Enhanced student filtering                  ✅
Student authentication by identifier/code   ✅
User/staff gender and email improvements    ✅
Self-service password change                ✅
JWT auth-version invalidation               ✅
Admin password reset                        ✅
Last-active-admin protection                ✅
Student Import                              ✅
Student Export                              ✅
Student Progress                            ✅
Course Offering improvements                ✅
Group enrollment preview/confirm            ✅
Named question sets                         ✅
Survey-version behavior                     ✅
Evaluation targeting                        ✅
Generation targeting                        ✅
Eligible-student preview                    ✅
Participant survey-version pinning          ✅
Version-aware Student Access                ✅
Version-aware Assessment Drafts             ✅
Version-aware Anonymous Submission          ✅
Safe apply-to-unfinished behavior            ✅
```

---

## Latest Verification

```text
TypeScript check:
npx tsc --noEmit
PASS ✅

Full regression:
Unit: 43 suites / 514 tests passed
API: 19 suites / 471 tests passed
PASS ✅
```

The current backend is ready for:

```text
Final API contract review
        |
        v
Frontend end-to-end testing
        |
        v
Fix only reproducible integration issues
        |
        v
Final regression
        |
        v
Internship defense / review
        |
        v
Merge / release decision
```

Large structural changes should be avoided during this stage unless final integration exposes a genuine defect.

---

# 28. Quick Start

For frontend preview, first follow [the isolated setup guide](TESTING.md#frontend-team-preview-from-the-github-repository): install the documented runtime/database, create local `teacher_evaluation_test`, run `npm.cmd ci`, copy `.env.test.example` only if `.env.test.local` does not exist, and configure private local test credentials. Then run each command successfully before the next:

```powershell
npm.cmd run test:e2e:generate
npm.cmd run test:e2e:check
npm.cmd run test:e2e:migrate
npm.cmd run test:e2e:seed
npm.cmd test -- --runInBand
npm.cmd run test:e2e
npm.cmd run build
npm.cmd run lint
npm.cmd run start:test
```

Open `http://localhost:3000/api/docs` and `http://localhost:3000/api/health`. Use the synthetic role accounts and request sequences in the consolidated report, then stop with Ctrl+C. This preview supplies the backend API; the frontend team must evaluate their own UI separately. Do not substitute the normal database or rerun seeding while other testers use the same accounts.

Latest full regression: 43 unit suites/514 tests and 19 API suites/471 tests passed; report Sections 9.1 and 11.12 record the evidence and completed local database alignment.

---

# Summary

The Assessment / Teaching Evaluation System backend provides a complete role-based evaluation workflow built with NestJS, Prisma, PostgreSQL, and JWT authentication.

The current implementation supports academic and student management, course offerings, enrollment, named/versioned question sets, evaluation participant targeting, student drafts, anonymous final submission, lecturer results, and safe questionnaire-version evolution.

The most important architectural principles are:

```text
Backend-enforced business rules

Explicit enrollment and participant assignment

Historical questionnaire preservation

Participant-level effective survey versions

Draft protection

Transactional final submission

Duplicate-submission protection

Anonymous final response storage

Role-based authorization
```

The current improvement implementation has passed the latest full regression checkpoint of:

```text
43 unit suites / 514 unit tests passed
19 API suites / 471 API tests passed
```

and is ready for final frontend integration testing and internship defense review.

Historical development note: the participant-level survey_version_id field was added through an existing versioned migration to preserve each unfinished student's effective questionnaire. That migration is supplied in the repository; frontend testers deploy existing migrations through the guarded runner instead of generating it again. Prisma generate rebuilds the client and does not change the database schema.
