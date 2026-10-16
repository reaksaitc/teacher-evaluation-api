const bcrypt = require('bcrypt');
const { isEmail } = require('class-validator');

async function provisionFirstAdministrator(prisma, input) {
  const name =
    typeof input.full_name === 'string' ? input.full_name.trim() : '';
  const email =
    typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = input.password;
  if (
    !name ||
    name.length > 150 ||
    !isEmail(email) ||
    email.length > 255 ||
    typeof password !== 'string' ||
    password.length < 6 ||
    password.length > 72 ||
    Buffer.byteLength(password, 'utf8') > 72
  )
    throw new Error(
      'Supply a valid name, email and password (6–72 characters, at most 72 UTF-8 bytes)',
    );
  const hash = await bcrypt.hash(password, 10);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(7248130202::bigint)`;
      // Any existing administrator prevents provisioning, including disabled accounts.
      if (await tx.users.count({ where: { role: 'ADMIN' } }))
        throw new Error(
          'An administrator already exists; provisioning refused',
        );
      if (await tx.users.count())
        throw new Error(
          'First-administrator provisioning requires an empty installation',
        );
      const now = new Date();
      const user = await tx.users.create({
        data: {
          full_name: name,
          email,
          password_hash: hash,
          role: 'ADMIN',
          status: 'ACTIVE',
          created_at: now,
          updated_at: now,
        },
      });
      return {
        id: String(user.id),
        email: user.email,
        role: user.role,
        status: user.status,
      };
    },
    { isolationLevel: 'Serializable' },
  );
}
module.exports = { provisionFirstAdministrator };
if (require.main === module) {
  const fs = require('node:fs');
  if (!process.env.DATABASE_URL && fs.existsSync('.env')) {
    const values = require('node:util').parseEnv(
      fs.readFileSync('.env', 'utf8'),
    );
    for (const [key, value] of Object.entries(values))
      if (process.env[key] === undefined) process.env[key] = value;
  }
  if (process.stdin.isTTY) {
    process.stderr.write(
      'Pipe JSON containing full_name, email and password through standard input. Password arguments are not accepted.\n',
    );
    process.exitCode = 1;
  } else {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    Promise.resolve()
      .then(() =>
        provisionFirstAdministrator(
          prisma,
          JSON.parse(fs.readFileSync(0, 'utf8')),
        ),
      )
      .then((receipt) => process.stdout.write(JSON.stringify(receipt) + '\n'))
      .catch((error) => {
        process.stderr.write(
          error.message?.startsWith('Supply') ||
            error.message?.includes('provisioning')
            ? error.message + '\n'
            : 'Provisioning failed; no credentials were printed. Check configuration and account state.\n',
        );
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  }
}
