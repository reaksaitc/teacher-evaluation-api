CREATE FUNCTION protect_response_audience_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.audience_major_id IS DISTINCT FROM OLD.audience_major_id OR NEW.audience_major_label IS DISTINCT FROM OLD.audience_major_label THEN
  RAISE EXCEPTION 'Anonymous response audience snapshot is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER response_audience_snapshot_immutable BEFORE UPDATE OF audience_major_id,audience_major_label ON responses
 FOR EACH ROW EXECUTE FUNCTION protect_response_audience_snapshot();
