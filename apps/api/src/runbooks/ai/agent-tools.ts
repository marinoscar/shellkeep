// =============================================================================
// The three tools of an AI runbook step (issue #64)
// =============================================================================
//
// Built with the platform's `defineTool`: each has a Zod `parameters` schema, and the model's arguments are
// untrusted until that schema has parsed them. The tools hold NO behaviour of their own: `execute` calls the
// handler the loop passes in, because what a `run_command` does depends on the approval mode (it runs, it is
// refused, or it is parked behind a person).
// =============================================================================

import { defineTool, type AiDefinedTool } from '@marinoscar/platform-api/ai';
import { z } from 'zod';

import type { AgentTool } from './agent-session';

const absPath = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^\/[^\0]*$/, 'Must be an absolute path without NUL bytes');

export const runCommandParameters = z.object({
  command: z.string().min(1).max(4096).describe('One shell command line, run non-interactively with bash'),
  reason: z.string().min(1).max(500).describe('One sentence: why this command, and what you expect to learn or change'),
});
export const readFileParameters = z.object({
  path: absPath,
  maxBytes: z.number().int().min(1).max(65_536).optional().describe('At most this many bytes from the start of the file (default 16384)'),
});
export const listDirParameters = z.object({ path: absPath });

export interface ToolHandlers {
  runCommand(args: z.output<typeof runCommandParameters>): Promise<unknown>;
  readFile(args: z.output<typeof readFileParameters>): Promise<unknown>;
  listDir(args: z.output<typeof listDirParameters>): Promise<unknown>;
}

/** The tools a step enables, in the model's order. */
export function buildTools(enabled: readonly AgentTool[], handlers: ToolHandlers): AiDefinedTool[] {
  const tools: AiDefinedTool[] = [];
  if (enabled.includes('run_command')) {
    tools.push(
      defineTool({
        name: 'run_command',
        description:
          'Run one shell command on the server. The result is { exitCode, output } with the output cleaned of control sequences and secrets and cut to 8 KiB, or { refused: true, reason } when the policy forbids it, or { rejected: true } when a person declined it.',
        parameters: runCommandParameters,
        execute: (args) => handlers.runCommand(args),
      }) as unknown as AiDefinedTool,
    );
  }
  if (enabled.includes('read_file')) {
    tools.push(
      defineTool({
        name: 'read_file',
        description: 'Read the start of a file on the server (absolute path). Private keys and password files are refused.',
        parameters: readFileParameters,
        execute: (args) => handlers.readFile(args),
      }) as unknown as AiDefinedTool,
    );
  }
  if (enabled.includes('list_dir')) {
    tools.push(
      defineTool({
        name: 'list_dir',
        description: 'List a directory on the server (absolute path), like `ls -la`.',
        parameters: listDirParameters,
        execute: (args) => handlers.listDir(args),
      }) as unknown as AiDefinedTool,
    );
  }
  return tools;
}
