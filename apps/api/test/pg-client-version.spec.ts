import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MIN_PG_CLIENT_MAJOR } from '@marinoscar/platform-api/db-backup/testing';

// =============================================================================
// The PostgreSQL client major is ONE decision written in TWO places (issue #52)
// =============================================================================
//
// `apps/api/Dockerfile` installs `postgresql<N>-client`; `MIN_PG_CLIENT_MAJOR`
// in `@marinoscar/platform-api/db-backup` is what the backup believes that N is
// and what its Doctor check and errors tell an operator to install. Nothing at
// runtime connects the two, so if they drift everything still compiles and the
// version guard starts giving advice that is wrong about the image it runs in.
// This test asserts the RULE (one explicitly pinned major, in the base stage,
// equal to the constant) rather than the current number.
// =============================================================================

const dockerfile = readFileSync(resolve(__dirname, '..', 'Dockerfile'), 'utf8');

/** The Dockerfile's instructions with comments removed, so prose naming the pin is not counted as one. */
const instructions = dockerfile
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** Everything from `AS base` up to the next stage; later stages inherit it. */
function baseStage(text: string): string {
  const start = text.indexOf('AS base');
  expect(start).toBeGreaterThan(-1);
  const rest = text.slice(start);
  const next = rest.indexOf('\nFROM ');
  return next === -1 ? rest : rest.slice(0, next);
}

function pinnedClientMajors(text: string): number[] {
  return [...text.matchAll(/postgresql(\d+)-client\b/g)].map((match) => Number.parseInt(match[1], 10));
}

describe('the pinned PostgreSQL client major', () => {
  it('matches MIN_PG_CLIENT_MAJOR exactly', () => {
    expect(pinnedClientMajors(instructions)).toEqual([MIN_PG_CLIENT_MAJOR]);
  });

  it('is installed in the base stage, which development and production both inherit', () => {
    expect(pinnedClientMajors(baseStage(instructions))).toEqual([MIN_PG_CLIENT_MAJOR]);
  });

  it('never uses the floating postgresql-client meta-package', () => {
    expect(/postgresql-client\b/.exec(instructions)).toBeNull();
  });

  it('installs it with a --no-cache apk invocation', () => {
    expect(new RegExp(String.raw`RUN apk add --no-cache [^\n]*postgresql${MIN_PG_CLIENT_MAJOR}-client`).test(instructions)).toBe(true);
  });
});
