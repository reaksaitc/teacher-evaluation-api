const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function loadTestEnvironment() {
  if (typeof parseEnv !== 'function') {
    throw new Error('This runner requires Node.js 20.12 or newer.');
  }

  const file = path.join(root, '.env.test.local');
  const config = parseEnv(fs.readFileSync(file, 'utf8'));

  if (config.NODE_ENV !== 'test') {
    throw new Error('.env.test.local must set NODE_ENV=test.');
  }

  if (!config.DATABASE_URL) {
    throw new Error('.env.test.local must contain DATABASE_URL.');
  }

  let url;
  try {
    url = new URL(config.DATABASE_URL);
  } catch {
    throw new Error('The test DATABASE_URL is invalid.');
  }

  const database = decodeURIComponent(url.pathname.slice(1));

  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    database !== 'teacher_evaluation_test'
  ) {
    throw new Error(
      'Blocked: tests require a local teacher_evaluation_test database.',
    );
  }

  if (config.DB_NAME !== database) {
    throw new Error(
      'DB_NAME and DATABASE_URL must name the same test database.',
    );
  }

  // Isolate compatibility rehearsals from an already-populated shared test database.
  if (process.env.TEST_DATABASE_SUFFIX !== undefined) {
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(process.env.TEST_DATABASE_SUFFIX))
      throw new Error('Invalid TEST_DATABASE_SUFFIX');
    const isolatedName = `teacher_evaluation_test_${process.env.TEST_DATABASE_SUFFIX}`;
    url.pathname = `/${isolatedName}`;
    config.DATABASE_URL = url.toString();
    config.DB_NAME = isolatedName;
  }

  Object.assign(process.env, config);

  // Keep the separate settings consistent with the validated URL.
  process.env.DB_HOST = url.hostname;
  process.env.DB_PORT = url.port || '5432';
  process.env.DB_NAME = config.DB_NAME;
  process.env.DB_USER = decodeURIComponent(url.username);
  process.env.DB_PASSWORD = decodeURIComponent(url.password);
  process.env.NODE_ENV = 'test';
}

loadTestEnvironment();

if (require.main === module) {
  const mode = process.argv[2];
  let args;

  if (mode === 'check') {
    console.log('Test configuration valid: teacher_evaluation_test');
    process.exit(0);
  } else if (mode === 'generate') {
    args = [require.resolve('prisma/build/index.js'), 'generate'];
  } else if (mode === 'migrate') {
    args = [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'];
  } else if (mode === 'test') {
    args = [
      '--experimental-vm-modules',
      require.resolve('jest/bin/jest'),
      '--config',
      'test/jest-e2e.json',
      '--runInBand',
      ...process.argv.slice(3),
    ];
  } else {
    throw new Error('Use check, generate, migrate, or test.');
  }

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}
