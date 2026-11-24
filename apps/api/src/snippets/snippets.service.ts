// =============================================================================
// Snippets: the caller's saved terminal text (issue #172)
// =============================================================================
//
// OWNER-ONLY. Every query names the user and the organization (`OwnerScope`); another user's snippet, and one
// that does not exist, are the same 404.
//
// NEVER LOGGED, NEVER SENT TO A MODEL. The body is user text that may hold a credential: this service never
// passes a title, body or tag to a logger, a span or an audit event (audit meta is the snippet id and counts),
// and no AI code imports it (`test/snippets/snippets-boundary.spec.ts`).
//
// ORDER is `position`, dense 0..n-1 per user. Create appends; delete and reorder renumber in one transaction.
// =============================================================================

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AUDIT_SINK, type AuditSink } from '@marinoscar/platform-api/core';
import type { Snippet } from '@prisma/client';

import { recordAudit } from '../common/audit/record-audit';
import type { OwnerScope } from '../common/types/owner-scope';
import { PrismaService } from '../prisma/prisma.service';
import { looksLikeSecret } from './secret-detector';
import { SNIPPET_WARNING_SECRET, SNIPPETS_PER_USER_MAX, type SnippetWarning } from './snippets.constants';
import { snippetError } from './snippets.error-codes';

export interface SnippetView {
  id: string;
  title: string;
  body: string;
  tags: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** A saved snippet, with the warning when its body looks like a credential (create and update only). */
export interface SnippetSaved extends SnippetView {
  warning: SnippetWarning | null;
}

function toView(row: Snippet): SnippetView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags ?? [],
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class SnippetsService {
  private readonly logger = new Logger(SnippetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
  ) {}

  /** The caller's snippets in their order, optionally filtered by a text found in the title, body or a tag. */
  async list(scope: OwnerScope, query?: string): Promise<{ items: SnippetView[] }> {
    const text = query?.trim();
    const rows = await this.prisma.snippet.findMany({
      where: {
        userId: scope.userId,
        orgId: scope.orgId,
        ...(text
          ? {
              OR: [
                { title: { contains: text, mode: 'insensitive' } },
                { body: { contains: text, mode: 'insensitive' } },
                { tags: { has: text.toLowerCase() } },
                { tags: { has: text } },
              ],
            }
          : {}),
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(toView) };
  }

  async create(scope: OwnerScope, input: { title: string; body: string; tags: string[] }): Promise<SnippetSaved> {
    const row = await this.prisma.$transaction(async (tx) => {
      const count = await tx.snippet.count({ where: { userId: scope.userId, orgId: scope.orgId } });
      if (count >= SNIPPETS_PER_USER_MAX) {
        throw snippetError('SNIPPET_LIMIT_REACHED', `You can keep at most ${SNIPPETS_PER_USER_MAX} snippets`);
      }
      const last = await tx.snippet.aggregate({ where: { userId: scope.userId, orgId: scope.orgId }, _max: { position: true } });
      return tx.snippet.create({
        data: { userId: scope.userId, orgId: scope.orgId, ...input, position: (last._max.position ?? -1) + 1 },
      });
    });
    await recordAudit(this.audit, this.logger, {
      action: 'snippet.create',
      actorUserId: scope.userId,
      targetType: 'snippet',
      targetId: row.id,
    });
    return { ...toView(row), warning: looksLikeSecret(row.body) ? SNIPPET_WARNING_SECRET : null };
  }

  async update(scope: OwnerScope, id: string, input: { title?: string; body?: string; tags?: string[] }): Promise<SnippetSaved> {
    const existing = await this.owned(scope, id);
    const row = await this.prisma.snippet.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
    });
    await recordAudit(this.audit, this.logger, {
      action: 'snippet.update',
      actorUserId: scope.userId,
      targetType: 'snippet',
      targetId: row.id,
    });
    return { ...toView(row), warning: looksLikeSecret(row.body) ? SNIPPET_WARNING_SECRET : null };
  }

  async remove(scope: OwnerScope, id: string): Promise<void> {
    await this.owned(scope, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.snippet.deleteMany({ where: { id, userId: scope.userId, orgId: scope.orgId } });
      await this.renumber(tx, scope, []);
    });
    await recordAudit(this.audit, this.logger, {
      action: 'snippet.delete',
      actorUserId: scope.userId,
      targetType: 'snippet',
      targetId: id,
    });
  }

  /**
   * Puts the named snippets first, in the given order; any the caller owns that the list does not name keep their
   * relative order after them (a snippet another device added meanwhile is never lost). A duplicate id is a 400;
   * an id that is not the caller's is a 404.
   */
  async reorder(scope: OwnerScope, ids: string[]): Promise<{ items: SnippetView[] }> {
    if (new Set(ids).size !== ids.length) throw snippetError('SNIPPET_ORDER_INVALID', 'The order list names a snippet twice');
    const owned = await this.prisma.snippet.count({ where: { id: { in: ids }, userId: scope.userId, orgId: scope.orgId } });
    if (owned !== ids.length) throw new NotFoundException('Snippet not found');
    await this.prisma.$transaction((tx) => this.renumber(tx, scope, ids));
    await recordAudit(this.audit, this.logger, {
      action: 'snippet.reorder',
      actorUserId: scope.userId,
      targetType: 'snippet',
      targetId: scope.userId,
      meta: { count: ids.length },
    });
    return this.list(scope);
  }

  private async owned(scope: OwnerScope, id: string): Promise<Snippet> {
    const row = await this.prisma.snippet.findFirst({ where: { id, userId: scope.userId, orgId: scope.orgId } });
    if (!row) throw new NotFoundException('Snippet not found');
    return row;
  }

  /** Rewrites `position` as 0..n-1: the `first` ids, then the rest in their current order. */
  private async renumber(
    tx: Pick<PrismaService, 'snippet'>,
    scope: OwnerScope,
    first: string[],
  ): Promise<void> {
    const rows = await tx.snippet.findMany({
      where: { userId: scope.userId, orgId: scope.orgId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, position: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = [...first.filter((id) => byId.has(id)), ...rows.map((row) => row.id).filter((id) => !first.includes(id))];
    for (const [index, id] of ordered.entries()) {
      if (byId.get(id)?.position !== index) await tx.snippet.update({ where: { id }, data: { position: index } });
    }
  }
}
