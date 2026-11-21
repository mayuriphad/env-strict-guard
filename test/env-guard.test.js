import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvExample, validateEnv } from '../dist/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('parseEnvExample - parses keys and detects inferred types correctly', () => {
  const content = `
# Server Configuration
PORT=3000
DEBUG=true
DATABASE_URL=https://db.local:5432
APP_SECRET="super-secret-key"
EMPTY_OPTIONAL=
`;

  const rules = parseEnvExample(content);
  assert.equal(rules.length, 5);

  assert.equal(rules[0].key, 'PORT');
  assert.equal(rules[0].type, 'number');

  assert.equal(rules[1].key, 'DEBUG');
  assert.equal(rules[1].type, 'boolean');

  assert.equal(rules[2].key, 'DATABASE_URL');
  assert.equal(rules[2].type, 'url');

  assert.equal(rules[3].key, 'APP_SECRET');
  assert.equal(rules[3].exampleValue, 'super-secret-key');
  assert.equal(rules[3].type, 'string');
});

test('validateEnv - flags missing and invalid environment variables', () => {
  const tmpExamplePath = path.resolve(process.cwd(), '.tmp.env.example');
  fs.writeFileSync(
    tmpExamplePath,
    'PORT=8080\nAPI_KEY=xyz\nIS_PROD=true\nDB_URL=postgres://localhost/db'
  );

  try {
    const invalidEnv = {
      PORT: 'not-a-number', // type mismatch
      IS_PROD: 'invalid-bool', // type mismatch
      DB_URL: 'invalid-url', // type mismatch
      // API_KEY is completely missing
    };

    const result = validateEnv({
      examplePath: tmpExamplePath,
      env: invalidEnv,
    });

    assert.equal(result.valid, false);
    assert.equal(result.issues.length, 4);

    const missing = result.issues.find((i) => i.key === 'API_KEY');
    assert.equal(missing?.issue, 'missing');

    const portMismatch = result.issues.find((i) => i.key === 'PORT');
    assert.equal(portMismatch?.issue, 'type_mismatch');
  } finally {
    if (fs.existsSync(tmpExamplePath)) {
      fs.unlinkSync(tmpExamplePath);
    }
  }
});

test('validateEnv - passes when all required variables and types match', () => {
  const tmpExamplePath = path.resolve(process.cwd(), '.tmp.valid.env.example');
  fs.writeFileSync(tmpExamplePath, 'PORT=5000\nSECRET=abc123\nACTIVE=true');

  try {
    const validEnv = {
      PORT: '5000',
      SECRET: 'my-production-secret',
      ACTIVE: 'true',
    };

    const result = validateEnv({
      examplePath: tmpExamplePath,
      env: validEnv,
    });

    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  } finally {
    if (fs.existsSync(tmpExamplePath)) {
      fs.unlinkSync(tmpExamplePath);
    }
  }
});

const withExample = (content, fn) => {
  const p = path.resolve(process.cwd(), `.tmp.${process.pid}.${Math.random().toString(36).slice(2)}.env.example`);
  fs.writeFileSync(p, content);
  try {
    return fn(p);
  } finally {
    fs.unlinkSync(p);
  }
};

test('parseEnvExample - 1 and 0 are numbers, only true/false are booleans', () => {
  const rules = parseEnvExample('WORKERS=1\nRETRIES=0\nDEBUG=false');
  assert.deepEqual(
    rules.map((r) => [r.key, r.type]),
    [
      ['WORKERS', 'number'],
      ['RETRIES', 'number'],
      ['DEBUG', 'boolean'],
    ]
  );
  withExample('WORKERS=1', (examplePath) => {
    assert.equal(validateEnv({ examplePath, env: { WORKERS: '4' } }).valid, true);
  });
});

test('parseEnvExample - strips inline comments, export and quotes', () => {
  const rules = parseEnvExample(
    'PORT=3000 # http port\nexport API_KEY=abc\nGREETING="hello # not a comment" # real comment\nCOLOR=#fff'
  );
  assert.deepEqual(
    rules.map((r) => [r.key, r.exampleValue, r.type]),
    [
      ['PORT', '3000', 'number'],
      ['API_KEY', 'abc', 'string'],
      ['GREETING', 'hello # not a comment', 'string'],
      ['COLOR', '#fff', 'string'],
    ]
  );
  withExample('PORT=3000 # http port', (examplePath) => {
    const result = validateEnv({ examplePath, env: { PORT: 'abc' } });
    assert.equal(result.issues[0]?.issue, 'type_mismatch');
  });
});

test('validateEnv - variables marked "# optional" may be missing or empty', () => {
  withExample('SENTRY_DSN= # optional\nTIMEOUT=30 # Optional, seconds\nTOKEN=x', (examplePath) => {
    const result = validateEnv({ examplePath, env: { SENTRY_DSN: '', TOKEN: 'y' } });
    assert.deepEqual(result.issues, []);
    // An optional variable that is set still has to match its type
    const bad = validateEnv({ examplePath, env: { TIMEOUT: 'soon', TOKEN: 'y' } });
    assert.deepEqual(bad.issues.map((i) => i.key), ['TIMEOUT']);
  });
});

test('validateEnv - messages do not include the received values', () => {
  withExample('DATABASE_URL=postgres://localhost/db\nPORT=1', (examplePath) => {
    const result = validateEnv({
      examplePath,
      env: { DATABASE_URL: 'super-secret-password', PORT: 'hunter2' },
    });
    assert.equal(result.issues.length, 2);
    for (const issue of result.issues) {
      assert.ok(!JSON.stringify(issue).includes('super-secret-password'));
      assert.ok(!JSON.stringify(issue).includes('hunter2'));
    }
  });
});

test('validateEnv - rejects numbers that are not finite', () => {
  withExample('RATE=1.5', (examplePath) => {
    assert.equal(validateEnv({ examplePath, env: { RATE: 'Infinity' } }).valid, false);
    assert.equal(validateEnv({ examplePath, env: { RATE: '2.25' } }).valid, true);
  });
});

test('loadEnvFile - fills missing variables and keeps ones already set', async () => {
  const { loadEnvFile } = await import('../dist/index.js');
  const envPath = path.resolve(process.cwd(), `.tmp.${process.pid}.env`);
  fs.writeFileSync(envPath, 'A=from-file\nB="quoted value"\n');
  try {
    const env = { A: 'already-set' };
    assert.equal(loadEnvFile(envPath, env), true);
    assert.deepEqual(env, { A: 'already-set', B: 'quoted value' });
    assert.equal(loadEnvFile(envPath + '.missing', env), false);
  } finally {
    fs.unlinkSync(envPath);
  }
});

test('cli - loads .env before validating', async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const cli = path.resolve('bin/cli.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-strict-guard-'));
  try {
    fs.writeFileSync(path.join(dir, '.env.example'), 'FOO=1\n');
    const env = { ...process.env };
    delete env.FOO;
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, env, encoding: 'utf-8' });

    assert.equal(run().status, 1);
    fs.writeFileSync(path.join(dir, '.env'), 'FOO=2\n');
    assert.equal(run().status, 0);
    assert.equal(run('--no-dotenv').status, 1);
    assert.equal(run('--bogus').status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
