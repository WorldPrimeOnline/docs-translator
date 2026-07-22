import type { FileResult } from './types';

/**
 * 0 = every file succeeded; 1 = at least one failed; 2 = only operator_review, no failures.
 * Exit code 3 (globally invalid config) is raised directly by index.ts before any file is
 * processed — it never reaches this function.
 */
export function computeExitCode(results: FileResult[]): 0 | 1 | 2 {
  if (results.some((r) => r.status === 'failed')) return 1;
  if (results.some((r) => r.status === 'operator_review')) return 2;
  return 0;
}
