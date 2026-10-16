-- Additive cutover: legacy cohorts and duplicate histories remain intact.
ALTER TABLE student_generations ADD COLUMN major_id BIGINT REFERENCES majors(id) ON DELETE NO ACTION,
  ADD COLUMN generation_number INTEGER;
DROP INDEX IF EXISTS student_generations_name_idx;
DROP INDEX IF EXISTS student_generations_name_key;
ALTER TABLE student_generations ADD CONSTRAINT generation_identity_pair CHECK (
  (major_id IS NULL AND generation_number IS NULL) OR
  (major_id IS NOT NULL AND generation_number IS NOT NULL AND generation_number BETWEEN 1 AND 2147483647));
CREATE UNIQUE INDEX student_generations_major_id_generation_number_key ON student_generations(major_id,generation_number);
-- No ownership inference from current placements. Explicit reviewed mapping is separate.
ALTER TABLE evaluation_participants ADD COLUMN placement_snapshot JSONB;
ALTER TABLE responses ADD COLUMN audience_major_id BIGINT, ADD COLUMN audience_major_label JSONB;
ALTER TABLE course_offerings ADD COLUMN source_offering_id BIGINT REFERENCES course_offerings(id) ON DELETE NO ACTION;
CREATE UNIQUE INDEX course_offerings_rollover_source_idx ON course_offerings(source_offering_id,semester_id)
  WHERE source_offering_id IS NOT NULL;

CREATE TABLE operation_receipts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id BIGINT NOT NULL, operation VARCHAR(60) NOT NULL,
 idempotency_key VARCHAR(128) NOT NULL, request_fingerprint VARCHAR(64) NOT NULL, result_json JSONB NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(actor_id,operation,idempotency_key)
);
CREATE TABLE evaluation_activity (
 id BIGSERIAL PRIMARY KEY, evaluation_id BIGINT NOT NULL, action VARCHAR(30) NOT NULL,
 occurred_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, actor_id BIGINT, actor_name VARCHAR(150),
 before_json JSONB, after_json JSONB,
 CHECK(action IN ('CREATED','SCHEDULED','DEADLINE_EXTENDED','CLOSED','SCHEDULE_UPDATED'))
);
CREATE INDEX evaluation_activity_evaluation_id_occurred_at_id_idx ON evaluation_activity(evaluation_id,occurred_at,id);
CREATE TABLE setup_audit (
 id BIGSERIAL PRIMARY KEY, destination_year_id BIGINT NOT NULL, source_year_id BIGINT,
 actor_id BIGINT NOT NULL, details JSONB NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE FUNCTION retain_alignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable audit or receipt cannot be modified' USING ERRCODE='23514'; END $$;
CREATE TRIGGER evaluation_activity_immutable BEFORE UPDATE OR DELETE ON evaluation_activity
 FOR EACH ROW EXECUTE FUNCTION retain_alignment_audit();
CREATE TRIGGER operation_receipts_immutable BEFORE UPDATE OR DELETE ON operation_receipts
 FOR EACH ROW EXECUTE FUNCTION retain_alignment_audit();
CREATE TRIGGER setup_audit_immutable BEFORE UPDATE OR DELETE ON setup_audit
 FOR EACH ROW EXECUTE FUNCTION retain_alignment_audit();

-- Stronger identities apply to new/context-changing writes; no destructive merge of legacy duplicates.
CREATE FUNCTION guard_evaluation_assignment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.course_offering_id=OLD.course_offering_id THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('evaluation-assignment:'||NEW.course_offering_id::text,0));
 IF EXISTS(SELECT 1 FROM evaluations WHERE course_offering_id=NEW.course_offering_id AND id<>NEW.id) THEN
   RAISE EXCEPTION 'EVALUATION_EXISTS: evaluation already exists for this teaching assignment' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evaluation_assignment_identity BEFORE INSERT OR UPDATE OF course_offering_id ON evaluations
 FOR EACH ROW EXECUTE FUNCTION guard_evaluation_assignment_identity();

CREATE FUNCTION guard_teaching_assignment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW.course_id,NEW.lecturer_id,NEW.semester_id,NEW.year_level,NEW.class_type)
  IS NOT DISTINCT FROM (OLD.course_id,OLD.lecturer_id,OLD.semester_id,OLD.year_level,OLD.class_type) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('teaching-assignment:'||NEW.course_id::text||':'||NEW.semester_id::text,0));
 IF EXISTS(SELECT 1 FROM course_offerings o WHERE o.id<>NEW.id AND o.course_id=NEW.course_id
  AND o.lecturer_id=NEW.lecturer_id AND o.semester_id=NEW.semester_id
  AND o.year_level IS NOT DISTINCT FROM NEW.year_level AND o.class_type IS NOT DISTINCT FROM NEW.class_type) THEN
  RAISE EXCEPTION 'ASSIGNMENT_EXISTS: teaching assignment already exists regardless of class label' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER teaching_assignment_identity BEFORE INSERT OR UPDATE ON course_offerings
 FOR EACH ROW EXECUTE FUNCTION guard_teaching_assignment_identity();

CREATE FUNCTION protect_alignment_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='evaluation_participants' AND NEW.placement_snapshot IS DISTINCT FROM OLD.placement_snapshot THEN
  RAISE EXCEPTION 'Participant placement snapshot is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER participant_placement_snapshot_immutable BEFORE UPDATE OF placement_snapshot ON evaluation_participants
 FOR EACH ROW EXECUTE FUNCTION protect_alignment_snapshot();
