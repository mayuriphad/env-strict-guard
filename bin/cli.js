#!/usr/bin/env node
import * as path from 'node:path';
import { loadEnvFile, validateEnv, formatIssues } from '../dist/index.js';

const USAGE = `Usage: env-strict-guard [--example <path>] [--env <path>] [--no-dotenv] [--allow-empty]

  --example <path>  Template to validate against (default: .env.example, .env.template or .env.sample)
  --env <path>      .env file to load before validating (default: .env)
  --no-dotenv       Validate the current environment only, without loading a .env file
  --allow-empty     Accept variables that are set but empty`;

const args = process.argv.slice(2);
let examplePath;
let envPath = '.env';
let loadDotenv = true;
let allowEmpty = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--example' || arg === '--env') {
    const value = args[++i];
    if (!value) {
      console.error(`${arg} needs a path.\n\n${USAGE}`);
      process.exit(2);
    }
    if (arg === '--example') examplePath = value;
    else envPath = value;
  } else if (arg === '--no-dotenv') {
    loadDotenv = false;
  } else if (arg === '--allow-empty') {
    allowEmpty = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else {
    console.error(`Unknown option: ${arg}\n\n${USAGE}`);
    process.exit(2);
  }
}

// A separate process does not see variables that only live in .env, so load them first.
// Variables already set in the environment win, as with dotenv.
if (loadDotenv) {
  loadEnvFile(path.resolve(process.cwd(), envPath));
}

const result = validateEnv({
  examplePath: examplePath && path.resolve(process.cwd(), examplePath),
  allowEmpty,
});

if (!result.valid) {
  console.error(formatIssues(result.issues));
  process.exit(1);
} else {
  console.log('\x1b[32m✔ [ENV-STRICT-GUARD] All required environment variables are set and valid.\x1b[0m');
  process.exit(0);
}
