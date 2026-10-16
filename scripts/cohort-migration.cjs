const crypto = require('node:crypto');
const fs = require('node:fs');
const { PrismaClient } = require('@prisma/client');
const normalize = (value) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? String(v) : v)),
  );
const digest = (value) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
function parseNumber(value) {
  const text = String(value)
    .trim()
    .replace(/^gen\s+/i, '');
  return /^\d+$/.test(text) &&
    Number.isInteger(Number(text)) &&
    Number(text) >= 1 &&
    Number(text) <= 2147483647
    ? Number(text)
    : null;
}
async function preflight(db) {
  const cohorts = await db.student_generations.findMany({
    include: {
      students: {
        orderBy: { id: 'asc' },
        select: {
          id: true,
          user_id: true,
          student_academic_records: {
            select: {
              id: true,
              major_id: true,
              academic_year_id: true,
              year_level: true,
              progression_action: true,
            },
            orderBy: { id: 'asc' },
          },
        },
      },
      course_offering_group_scopes: { orderBy: { id: 'asc' } },
      evaluation_group_targets: { orderBy: { id: 'asc' } },
      evaluation_targets: {
        orderBy: [{ evaluation_id: 'asc' }, { generation_id: 'asc' }],
      },
    },
    orderBy: { id: 'asc' },
  });
  const duplicateAssignments =
    await db.$queryRaw`SELECT course_id::text,lecturer_id::text,semester_id::text,year_level,class_type, array_agg(id::text ORDER BY id) AS ids FROM course_offerings GROUP BY course_id,lecturer_id,semester_id,year_level,class_type HAVING count(*)>1 ORDER BY 1`;
  const duplicateEvaluations =
    await db.$queryRaw`SELECT course_offering_id::text,array_agg(id::text ORDER BY id) AS ids FROM evaluations GROUP BY course_offering_id HAVING count(*)>1 ORDER BY 1`;
  const courseCodeCollisions =
    await db.$queryRaw`SELECT lower(course_code) AS normalized,array_agg(id::text ORDER BY id) AS ids FROM courses GROUP BY lower(course_code) HAVING count(*)>1 ORDER BY 1`;
  const result = {
    cohorts: cohorts.map((c) => ({
      ...normalize(c),
      parsed_generation_number: parseNumber(c.name),
      status:
        c.major_id === null ? 'REVIEWED_OWNERSHIP_MAPPING_REQUIRED' : 'SCOPED',
      historical_major_ids: [
        ...new Set([
          ...c.students.flatMap((s) =>
            s.student_academic_records.map((p) => String(p.major_id)),
          ),
          ...c.course_offering_group_scopes.map((g) => String(g.major_id)),
          ...c.evaluation_group_targets.map((g) => String(g.major_id)),
        ]),
      ],
    })),
    duplicateAssignments: normalize(duplicateAssignments),
    duplicateEvaluations: normalize(duplicateEvaluations),
    courseCodeCollisions: normalize(courseCodeCollisions),
  };
  return { ...result, source_fingerprint: digest(result) };
}
async function applyReviewedPlan(prisma, plan) {
  if (
    plan.approved !== true ||
    typeof plan.reviewed_by !== 'string' ||
    !plan.reviewed_by.trim() ||
    !plan.rationale?.trim() ||
    !/^[a-f0-9]{64}$/.test(plan.source_fingerprint || '') ||
    !Array.isArray(plan.mappings) ||
    !plan.mappings.length
  )
    throw new Error(
      'An explicitly approved plan, reviewer, rationale, source fingerprint and mappings are required',
    );
  const key = digest(plan);
  return prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7248130203::bigint)`;
      const where = {
        actor_id_operation_idempotency_key: {
          actor_id: 0n,
          operation: 'COHORT_MIGRATION',
          idempotency_key: key,
        },
      };
      const receipt = await db.operation_receipts.findUnique({ where });
      if (receipt) return receipt.result_json;
      const before = await preflight(db);
      if (before.source_fingerprint !== plan.source_fingerprint)
        throw new Error('Migration source changed; review a fresh preflight');
      const assigned = new Set(),
        preserved = new Set(),
        sources = new Set(),
        targets = new Set();
      // Validate the entire explicit mapping before any writes.
      for (const m of plan.mappings) {
        const source = before.cohorts.find(
          (c) => c.id === m.source_generation_id,
        );
        if (!source || source.major_id !== null)
          throw new Error(
            'Mapping must identify a read-only legacy source cohort',
          );
        const number = parseNumber(m.generation_number);
        if (number === null || typeof m.generation_number !== 'number')
          throw new Error('Mapping generation_number must be a JSON integer');
        const targetKey = JSON.stringify([m.target_major_id, number]);
        if (targets.has(targetKey))
          throw new Error(
            'Same-major target collision; cohorts are never silently merged',
          );
        targets.add(targetKey);
        if (
          await db.student_generations.findUnique({
            where: {
              major_id_generation_number: {
                major_id: BigInt(m.target_major_id),
                generation_number: number,
              },
            },
          })
        )
          throw new Error(
            'Target major/number already exists; review collision separately',
          );
        if (
          !(await db.majors.findUnique({
            where: { id: BigInt(m.target_major_id) },
          })) ||
          !(await db.academic_years.findUnique({
            where: { id: BigInt(m.entry_academic_year_id) },
          })) ||
          !Number.isInteger(m.starting_year_level) ||
          m.starting_year_level < 1 ||
          m.starting_year_level > 5
        )
          throw new Error('Invalid reviewed major/entry metadata');
        if (!Array.isArray(m.student_ids))
          throw new Error(
            'Explicit student_ids are required, including an empty list',
          );
        for (const id of m.student_ids) {
          if (assigned.has(id) || !source.students.some((s) => s.id === id))
            throw new Error(
              'Student mapping is duplicate or does not belong to source',
            );
          assigned.add(id);
        }
        if (m.preserve_source_id) {
          if (
            preserved.has(source.id) ||
            plan.mappings.some(
              (other) =>
                other !== m && other.source_generation_id === source.id,
            ) ||
            source.students.length !== m.student_ids.length ||
            source.historical_major_ids.some(
              (id) => id !== m.target_major_id,
            ) ||
            source.parsed_generation_number !== number ||
            source.entry_academic_year_id !== m.entry_academic_year_id ||
            source.starting_year_level !== m.starting_year_level ||
            [
              ...source.course_offering_group_scopes,
              ...source.evaluation_group_targets,
            ].some((g) => g.major_id !== m.target_major_id)
          )
            throw new Error(
              'A shared legacy cohort cannot be assigned to one major; split with new IDs',
            );
          preserved.add(source.id);
        }
        sources.add(source.id);
      }
      for (const sourceId of sources) {
        const source = before.cohorts.find((c) => c.id === sourceId);
        if (source.students.some((s) => !assigned.has(s.id)))
          throw new Error(
            'Map every student in each reviewed source cohort explicitly',
          );
      }
      const mappings = [];
      for (const m of plan.mappings) {
        const data = {
          major_id: BigInt(m.target_major_id),
          generation_number: m.generation_number,
          entry_academic_year_id: BigInt(m.entry_academic_year_id),
          starting_year_level: m.starting_year_level,
        };
        const cohort = m.preserve_source_id
          ? await db.student_generations.update({
              where: { id: BigInt(m.source_generation_id) },
              data,
            })
          : await db.student_generations.create({
              data: { ...data, name: `Gen ${m.generation_number}` },
            });
        if (!m.preserve_source_id)
          await db.students.updateMany({
            where: {
              generation_id: BigInt(m.source_generation_id),
              id: { in: m.student_ids.map(BigInt) },
            },
            data: { generation_id: cohort.id },
          });
        mappings.push({
          source_generation_id: m.source_generation_id,
          target_generation_id: String(cohort.id),
          student_ids: m.student_ids,
          preserved_source_id: !!m.preserve_source_id,
        });
      }
      // Frozen evaluation targets, snapshots, answers, enrollments, and historical offering scopes are retained unchanged.
      const result = {
        reviewed_by: plan.reviewed_by,
        rationale: plan.rationale,
        source_fingerprint: plan.source_fingerprint,
        mappings,
        historical_relations: 'RETAINED_AS_READ_ONLY_LEGACY_REFERENCES',
      };
      await db.operation_receipts.create({
        data: {
          actor_id: 0n,
          operation: 'COHORT_MIGRATION',
          idempotency_key: key,
          request_fingerprint: key,
          result_json: normalize(result),
        },
      });
      return result;
    },
    { isolationLevel: 'Serializable', timeout: 60000 },
  );
}
module.exports = { preflight, applyReviewedPlan, parseNumber };
if (require.main === module) {
  if (!process.env.DATABASE_URL && fs.existsSync('.env'))
    for (const [k, v] of Object.entries(
      require('node:util').parseEnv(fs.readFileSync('.env', 'utf8')),
    ))
      if (process.env[k] === undefined) process.env[k] = v;
  const db = new PrismaClient();
  const args = process.argv.slice(2);
  Promise.resolve()
    .then(() =>
      args[0] === '--apply' && args[1]
        ? applyReviewedPlan(db, JSON.parse(fs.readFileSync(args[1], 'utf8')))
        : preflight(db),
    )
    .then((result) =>
      process.stdout.write(JSON.stringify(result, null, 2) + '\n'),
    )
    .catch((error) => {
      process.stderr.write(
        'Cohort preflight/mapping failed: ' +
          (error.message?.startsWith('Invalid `')
            ? 'database operation rejected'
            : error.message) +
          '\n',
      );
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
