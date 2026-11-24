// =============================================================================
// Run parameters (issue #62)
// =============================================================================
//
// PURE. Checks the values a run supplies against the runbook definition: unknown names, required
// parameters, types, enum options and `pattern` (RE2). A secret parameter takes no value here (a run
// names the runbook secret that fills it: `secretRefs`). The result holds the NON-SECRET values with their
// defaults, which is what a run row stores; parameters reach commands only as environment variables.
// =============================================================================

import { re2Test } from '../schema/re2-pattern';
import type { RunbookDefinition } from '../schema/runbook-definition.schema';

export interface ParamIssue {
  path: string;
  message: string;
}

export interface ParamsResult {
  values: Record<string, string | number | boolean>;
  /** Parameter name to the secret name it needs. */
  secretRefs: Record<string, string>;
  issues: ParamIssue[];
}

export function checkRunParams(
  definition: Pick<RunbookDefinition, 'parameters'>,
  params: Readonly<Record<string, string | number | boolean>>,
  secretRefs: Readonly<Record<string, string>>,
): ParamsResult {
  const issues: ParamIssue[] = [];
  const values: ParamsResult['values'] = {};
  const refs: Record<string, string> = {};
  const declared = new Map(definition.parameters.map((p) => [p.name, p]));

  for (const name of Object.keys(params)) {
    const parameter = declared.get(name);
    if (!parameter) issues.push({ path: `params.${name}`, message: 'Not a parameter of this runbook' });
    else if (parameter.type === 'secret') issues.push({ path: `params.${name}`, message: 'A secret parameter takes a secret reference, never a value' });
  }
  for (const name of Object.keys(secretRefs)) {
    const parameter = declared.get(name);
    if (!parameter) issues.push({ path: `secretRefs.${name}`, message: 'Not a parameter of this runbook' });
    else if (parameter.type !== 'secret') issues.push({ path: `secretRefs.${name}`, message: 'Only a secret parameter takes a secret reference' });
  }

  for (const parameter of definition.parameters) {
    if (parameter.type === 'secret') {
      const ref = secretRefs[parameter.name];
      if (ref !== undefined) refs[parameter.name] = ref;
      else if (parameter.required) issues.push({ path: `secretRefs.${parameter.name}`, message: 'Required' });
      continue;
    }
    const supplied = params[parameter.name];
    const value = supplied !== undefined ? supplied : parameter.default;
    if (value === undefined) {
      if (parameter.required) issues.push({ path: `params.${parameter.name}`, message: 'Required' });
      continue;
    }
    const path = `params.${parameter.name}`;
    switch (parameter.type) {
      case 'string':
        if (typeof value !== 'string') issues.push({ path, message: 'Must be a string' });
        else if (parameter.pattern !== undefined && !re2Test(parameter.pattern, value)) issues.push({ path, message: 'Does not match the required pattern' });
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) issues.push({ path, message: 'Must be a number' });
        break;
      case 'boolean':
        if (typeof value !== 'boolean') issues.push({ path, message: 'Must be true or false' });
        break;
      case 'enum':
        if (typeof value !== 'string' || !(parameter.options ?? []).includes(value)) issues.push({ path, message: 'Must be one of the options' });
        break;
    }
    values[parameter.name] = value;
  }
  return { values, secretRefs: refs, issues };
}
