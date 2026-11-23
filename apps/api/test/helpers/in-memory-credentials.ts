// =============================================================================
// An in-memory `user_credentials` table for the REAL `UserCredentialsService`
// (issue #48)
// =============================================================================
//
// The platform store reaches the database through `forUser(prisma, scope)`, which
// calls `$extends` on the client and uses its `userCredential` delegate. This fake
// answers `$extends` with itself and implements exactly the calls the service makes
// (`findUnique` by `userId_purpose_name`, `upsert`, `update`, `findMany`,
// `deleteMany`), so a spec exercises the real cipher, the real owner binding and the
// real address rules without a database. `rows` is the stored table: a spec reads a
// ciphertext from it, or copies one row's `secret` into another owner's row.
// =============================================================================

export interface StoredUserCredential {
  id: string;
  userId: string;
  purpose: string;
  name: string;
  secret: string;
  hint: string | null;
  label: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const keyOf = (userId: string, purpose: string, name: string) => `${userId}\u0000${purpose}\u0000${name}`;

export function createInMemoryCredentialPrisma() {
  const rows = new Map<string, StoredUserCredential>();
  let sequence = 0;

  const project = (row: StoredUserCredential, select?: Record<string, boolean>) => {
    if (!select) return { ...row };
    return Object.fromEntries(Object.entries(select).filter(([, on]) => on).map(([k]) => [k, (row as any)[k]]));
  };

  const userCredential = {
    findUnique: async ({ where, select }: any) => {
      const { userId, purpose, name } = where.userId_purpose_name;
      const row = rows.get(keyOf(userId, purpose, name));
      return row ? project(row, select) : null;
    },
    findMany: async ({ where, select }: any) => {
      const matching = [...rows.values()]
        .filter((row) => row.userId === where.userId && (where.purpose === undefined || row.purpose === where.purpose))
        .sort((a, b) => a.purpose.localeCompare(b.purpose) || a.name.localeCompare(b.name));
      return matching.map((row) => project(row, select));
    },
    upsert: async ({ where, create, update }: any) => {
      const { userId, purpose, name } = where.userId_purpose_name;
      const key = keyOf(userId, purpose, name);
      const now = new Date();
      const existing = rows.get(key);
      const row: StoredUserCredential = existing
        ? { ...existing, ...update, updatedAt: now }
        : {
            id: `cred-${++sequence}`,
            userId,
            purpose,
            name,
            secret: create.secret,
            hint: create.hint ?? null,
            label: create.label ?? null,
            createdAt: now,
            updatedAt: now,
          };
      rows.set(key, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = [...rows.values()].find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (const [key, row] of rows) {
        if (row.userId === where.userId && row.purpose === where.purpose && row.name === where.name) {
          rows.delete(key);
          count += 1;
        }
      }
      return { count };
    },
  };

  const prisma: any = { userCredential, $extends: () => prisma };

  return { prisma, rows, keyOf };
}
