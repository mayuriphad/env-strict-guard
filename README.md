# env-strict-guard 🛡️

> Zero-config environment variable validator. Prevents production crashes by enforcing that all required keys and types declared in your `.env.example` are present before your application starts up.

[![npm version](https://img.shields.io/npm/v/env-strict-guard.svg)](https://www.npmjs.com/package/env-strict-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Zero Runtime Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#)

---

### The Problem It Solves

You add a new variable (`STRIPE_SECRET_KEY`) locally, merge a pull request, and deploy. The server boots normally, but hours later when an endpoint runs:

```
TypeError: Cannot read properties of undefined
```

Existing schema validators (like Zod or Joi) require dozens of lines of manual schema boilerplate. 

`env-strict-guard` automatically parses your existing `.env.example` file, infers expected types (numbers, booleans, URLs), and immediately halts launch with a readable diagnostic error if anything is missing.

---

### Installation

```bash
npm install env-strict-guard
```

---

### Quick Start

Add this one line at the very top of your application entry point (`index.ts` / `server.js`):

```typescript
import { assertEnv } from 'env-strict-guard';

// Validates process.env against .env.example
assertEnv();
```

If a variable is missing or invalid, your application halts with clear error feedback:

```
[ENV-STRICT-GUARD] Missing or Invalid Environment Configuration!
Your environment does not satisfy requirements defined in .env.example:

  • DATABASE_URL: Missing required environment variable 'DATABASE_URL'
  • PORT: Expected 'PORT' to be a number (example: '3000')

Please set these variables in your .env or deployment platform before launching.
```

Messages never print the values that were received, so the report is safe to show in CI logs.

---

### How `.env.example` Is Read

```bash
PORT=3000                 # number
DEBUG=false               # boolean (only true/false; 1 and 0 are numbers)
DATABASE_URL=postgres://localhost/app   # url
export API_KEY=change-me  # string; a leading `export` is ignored
SENTRY_DSN= # optional    # may be missing or empty
```

- The type is inferred from the example value: `true`/`false` → boolean, digits → number, `scheme://...` → url, anything else → string.
- A `#` starts a comment when whitespace comes before it, so `COLOR=#fff` keeps its value. Quoted values may contain `#`.
- Every variable is required unless its comment starts with `optional`. An optional variable that is set must still match its type.

---

### CLI Usage

You can also run it via terminal or pre-commit hook without importing it into code:

```bash
npx env-strict-guard
```

The CLI runs in its own process, so it loads `.env` from the current directory first (variables already set in the environment win). Options:

```
--example <path>  Template to validate against (default: .env.example, .env.template or .env.sample)
--env <path>      .env file to load before validating (default: .env)
--no-dotenv       Validate the current environment only
--allow-empty     Accept variables that are set but empty
```

`assertEnv()` does not load `.env` by itself. Call `loadEnvFile()` first if your app does not already use dotenv:

```typescript
import { assertEnv, loadEnvFile } from 'env-strict-guard';

loadEnvFile(); // reads ./.env into process.env without overwriting existing variables
assertEnv();
```

Add it to your `package.json` scripts:

```json
{
  "scripts": {
    "prebuild": "env-strict-guard",
    "prestart": "env-strict-guard"
  }
}
```

---

### Programmatic API

```typescript
import { validateEnv } from 'env-strict-guard';

const result = validateEnv({
  examplePath: './custom.env.template',
  allowEmpty: false, // default: set-but-empty variables are reported
});

if (!result.valid) {
  console.log(result.issues);
}
```

---

### License

MIT © [Mayuri Phad](https://github.com/mayuriphad)
