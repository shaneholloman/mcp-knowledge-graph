// Regression tests for the path-traversal hardening in getMemoryFilePath.
//
// These cover the vulnerability reported in issue #21: a `context` value was
// interpolated raw into a filename (`memory-${context}.jsonl`) with no
// validation, allowing `../` traversal to escape the configured storage
// directory on the create/save path.
//
// Run with: npm test  (builds, then runs the compiled tests with node:test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// Imported from the compiled module. The server's main() is guarded so importing
// here does not start a stdio transport.
import { assertContextSafe, assertInScope } from '../index.js';

test('assertContextSafe accepts ordinary context identifiers', () => {
  for (const ok of ['work', 'personal', 'health', 'project_2024', 'a-b.c', 'A1']) {
    assert.doesNotThrow(() => assertContextSafe(ok), `expected "${ok}" to be accepted`);
  }
});

test('assertContextSafe rejects path separators', () => {
  for (const bad of ['a/b', 'a\\b', 'work/../../etc']) {
    assert.throws(() => assertContextSafe(bad), /path separators|only letters/, `expected "${bad}" to be rejected`);
  }
});

test('assertContextSafe rejects traversal segments', () => {
  for (const bad of ['..', '.']) {
    assert.throws(() => assertContextSafe(bad), /traversal segments/, `expected "${bad}" to be rejected`);
  }
});

test('assertContextSafe rejects the issue #21 payload', () => {
  // The reporter's traversal example: enough ../ to reach an arbitrary
  // process-writable location. The slash makes this fail outright.
  assert.throws(() => assertContextSafe('../../../../tmp/pwned'), /path separators/);
});

test('assertContextSafe rejects empty and non-string input', () => {
  assert.throws(() => assertContextSafe(''), /non-empty string/);
  // @ts-expect-error intentional misuse for runtime guard coverage
  assert.throws(() => assertContextSafe(undefined), /non-empty string/);
  // @ts-expect-error intentional misuse for runtime guard coverage
  assert.throws(() => assertContextSafe(123), /non-empty string/);
});

test('assertContextSafe rejects characters outside the allow-list', () => {
  for (const bad of ['a b', 'a:b', 'a*b', 'a$b', 'café']) {
    assert.throws(() => assertContextSafe(bad), /only letters/, `expected "${bad}" to be rejected`);
  }
});

test('assertInScope accepts a target inside the base directory', () => {
  const base = path.resolve('/tmp/kg-base');
  const target = path.join(base, 'memory-work.jsonl');
  assert.doesNotThrow(() => assertInScope(target, base));
});

test('assertInScope rejects a target that escapes the base directory', () => {
  const base = path.resolve('/tmp/kg-base');
  const escaped = path.join(base, '..', '..', 'tmp', 'pwned.jsonl');
  assert.throws(() => assertInScope(escaped, base), /escapes the configured storage directory/);
});

test('assertInScope rejects the base directory itself', () => {
  const base = path.resolve('/tmp/kg-base');
  assert.throws(() => assertInScope(base, base), /escapes the configured storage directory/);
});

test('assertInScope rejects an absolute path outside base', () => {
  const base = path.resolve('/tmp/kg-base');
  assert.throws(() => assertInScope('/etc/passwd', base), /escapes the configured storage directory/);
});
