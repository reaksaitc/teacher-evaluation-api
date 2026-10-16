-- Do not normalize or rename legacy codes. A collision requires an explicit reviewed resolution before deployment.
DO $migration$
BEGIN
 IF EXISTS (SELECT lower(course_code) FROM courses GROUP BY lower(course_code) HAVING COUNT(*)>1) THEN
  RAISE EXCEPTION 'Course-code preflight: case-insensitive collisions require reviewed resolution; no codes were changed' USING ERRCODE='23514';
 END IF;
 CREATE UNIQUE INDEX courses_code_case_insensitive_idx ON courses(lower(course_code));
END $migration$;
