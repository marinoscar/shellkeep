// In-memory stand-ins for the tables the session summary touches (#59), shared by the handler's
// conformance spec and the HTTP integration spec. Only the `where` shapes the code under test uses.

export interface FakeSummaryRow {
  id: string;
  sessionId: string;
  userId: string;
  orgId: string | null;
  jobId: string | null;
  status: string;
  summaryMd: string | null;
  commands: unknown;
  findings: unknown;
  sourceChars: number | null;
  truncated: boolean;
  model: string | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

type Where = Record<string, unknown>;

const matches = (row: Record<string, unknown>, where: Where = {}): boolean =>
  Object.entries(where).every(([key, expected]) => {
    if (expected !== null && typeof expected === 'object' && 'lt' in (expected as object)) {
      return (row[key] as Date) < ((expected as { lt: Date }).lt as Date);
    }
    return row[key] === expected;
  });

export interface FakeSession {
  id: string;
  userId: string;
  orgId: string;
  status: string;
  serverProfileId: string;
}

export function createFakeSummaryPrisma(sessions: () => FakeSession[]) {
  const rows: FakeSummaryRow[] = [];
  let counter = 0;
  const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  const sorted = (list: FakeSummaryRow[], orderBy?: { createdAt?: 'asc' | 'desc' }) =>
    orderBy?.createdAt === 'desc' ? [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : list;

  const terminalSessionSummary = {
    create: jest.fn(async ({ data }: { data: Partial<FakeSummaryRow> }) => {
      const row: FakeSummaryRow = {
        id: id(),
        sessionId: '',
        userId: '',
        orgId: null,
        jobId: null,
        status: 'pending',
        summaryMd: null,
        commands: null,
        findings: null,
        sourceChars: null,
        truncated: false,
        model: null,
        errorCode: null,
        createdAt: new Date(),
        completedAt: null,
        ...data,
      };
      rows.push(row);
      return { ...row };
    }),
    findFirst: jest.fn(async ({ where, orderBy }: { where?: Where; orderBy?: { createdAt?: 'asc' | 'desc' } }) => {
      const found = sorted(rows.filter((r) => matches(r as never, where)), orderBy)[0];
      return found ? { ...found } : null;
    }),
    findMany: jest.fn(async ({ where, orderBy, take }: { where?: Where; orderBy?: { createdAt?: 'asc' | 'desc' }; take?: number }) =>
      sorted(rows.filter((r) => matches(r as never, where)), orderBy)
        .slice(0, take)
        .map((r) => ({ ...r })),
    ),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeSummaryRow> }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Where; data: Partial<FakeSummaryRow> }) => {
      const hit = rows.filter((r) => matches(r as never, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
    deleteMany: jest.fn(async ({ where }: { where: Where }) => {
      const keep = rows.filter((r) => !matches(r as never, where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    }),
  };

  const terminalSession = {
    findFirst: jest.fn(async ({ where }: { where: Where }) => sessions().find((s) => matches(s as never, where)) ?? null),
  };

  return { rows, prisma: { terminalSessionSummary, terminalSession } };
}
