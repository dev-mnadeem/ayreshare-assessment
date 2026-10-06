import type { z } from 'zod';

/** One problem with one field, phrased for a developer fixing their request. */
export interface FieldIssue {
  readonly field: string;
  readonly message: string;
  /** Required field absent: reported in the "Missing required fields" list. */
  readonly missing?: boolean;
}

function pathToField(path: readonly PropertyKey[]): string {
  return path.reduce<string>((acc, key) => {
    if (typeof key === 'number') return `${acc}[${key}]`;
    return acc ? `${acc}.${String(key)}` : String(key);
  }, '');
}

/**
 * Converts Zod issues to FieldIssues. Parse with `reportInput: true` so a missing field
 * (input undefined) can be told apart from a wrong type.
 */
export function fromZodIssues(issues: readonly z.core.$ZodIssue[]): FieldIssue[] {
  return issues.flatMap((issue): FieldIssue[] => {
    const field = pathToField(issue.path);

    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        field: field ? `${field}.${key}` : key,
        message: 'is not a supported field (check the spelling against the docs)',
      }));
    }
    if (issue.code === 'invalid_type' && issue.input === undefined) {
      return [{ field, message: 'is required', missing: true }];
    }
    if (
      issue.code === 'invalid_type' &&
      issue.expected === 'string' &&
      isUnsafeNumber(issue.input)
    ) {
      // e.g. a 19-digit TikTok ID sent unquoted: JSON parsing has already rounded it.
      return [
        {
          field,
          message:
            'must be sent as a string: this number is too large to be represented exactly, so its digits were already changed in transit. Quote the ID, e.g. "7301234567890123456"',
        },
      ];
    }
    if (issue.code === 'invalid_type') {
      return [{ field, message: `must be ${article(issue.expected)}` }];
    }
    return [{ field: field || 'body', message: issue.message }];
  });
}

function isUnsafeNumber(input: unknown): boolean {
  return typeof input === 'number' && !Number.isSafeInteger(input);
}

function article(expected: string): string {
  return /^[aeiou]/.test(expected) ? `an ${expected}` : `a ${expected}`;
}

/**
 * One `details` string naming every problem, e.g.
 * "Missing required fields: budget, endDate. Invalid fields: goal must be one of ...; ..."
 */
export function formatIssues(issues: readonly FieldIssue[]): string {
  const missing = [...new Set(issues.filter((i) => i.missing).map((i) => i.field))];
  const invalid = issues.filter((i) => !i.missing).map((i) => `${i.field} ${i.message}`);

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Missing required fields: ${missing.join(', ')}.`);
  if (invalid.length > 0) parts.push(`Invalid fields: ${invalid.join('; ')}.`);
  return parts.join(' ');
}
