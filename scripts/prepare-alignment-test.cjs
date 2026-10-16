require('../test/run-e2e.cjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const name = 'teacher_evaluation_test_alignment';
  const existing =
    await prisma.$queryRaw`SELECT 1 FROM pg_database WHERE datname=${name}`;
  if (!existing.length)
    await prisma.$executeRawUnsafe(
      'CREATE DATABASE "teacher_evaluation_test_alignment"',
    );
  process.stdout.write(
    'Dedicated local alignment test database is ready; existing application data was preserved.\n',
  );
})()
  .catch(() => {
    process.stderr.write(
      'Test preparation failed. No application records were changed.\n',
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
