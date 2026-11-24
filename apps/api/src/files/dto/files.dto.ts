import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const path = z.string().min(1).max(4096);
const sessionId = z.string().uuid().optional();

export const filesPathQuerySchema = z.object({
  /** Absolute, `~`, or relative (resolved against the session's working directory with `sessionId`, else home). */
  path: path.default('~'),
  sessionId,
});

export const filesStatQuerySchema = z.object({ path, sessionId });

export const filesContentQuerySchema = z.object({
  path,
  sessionId,
  offset: z.coerce.number().int().min(0).optional(),
  length: z.coerce.number().int().min(1).optional(),
});

export const downloadTokenBodySchema = z.object({ path, sessionId });

export class FilesPathQueryDto extends createZodDto(filesPathQuerySchema) {}
export class FilesStatQueryDto extends createZodDto(filesStatQuerySchema) {}
export class FilesContentQueryDto extends createZodDto(filesContentQuerySchema) {}
export class DownloadTokenBodyDto extends createZodDto(downloadTokenBodySchema) {}
