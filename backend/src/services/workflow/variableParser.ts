export interface WorkflowContext {
  trigger: Record<string, any>;
  config: Record<string, any>;
  steps: Record<string, { input?: any; output?: any; status?: string; error?: string }>;
  variables: Record<string, any>;
  metadata: Record<string, any>;
}

/**
 * Gets a nested property from an object using a dot-separated path.
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => {
    if (acc === null || acc === undefined) {
      return undefined;
    }
    // Handle array indices e.g., items[0]
    const arrayMatch = part.match(/(.*)\[(\d+)\]$/);
    if (arrayMatch) {
      const prop = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      return prop === '' ? acc[index] : acc[prop]?.[index];
    }
    return acc[part];
  }, obj);
}

/**
 * Resolves all {{variable}} templates in a string.
 */
function resolveString(str: string, context: WorkflowContext): any {
  const variableRegex = /\{\{([^}]+)\}\}/g;
  
  // If the entire string is just one variable, return its raw resolved type (e.g., preserving arrays/objects)
  const exactMatch = str.match(/^\{\{([^}]+)\}\}$/);
  if (exactMatch) {
    const path = exactMatch[1].trim();
    const value = getNestedValue(context, path);
    if (value === undefined) {
      return null;
    }
    return value;
  }

  // Otherwise do string replacement
  return str.replace(variableRegex, (match, path) => {
    const trimmedPath = path.trim();
    const value = getNestedValue(context, trimmedPath);
    if (value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  });
}

/**
 * Recursively traverses an input schema/payload and resolves all {{variables}}.
 */
export function resolveVariables(input: any, context: WorkflowContext): any {
  if (typeof input === 'string') {
    return resolveString(input, context);
  }

  if (Array.isArray(input)) {
    return input.map(item => resolveVariables(item, context));
  }

  if (input !== null && typeof input === 'object') {
    const resolvedObject: Record<string, any> = {};
    for (const key of Object.keys(input)) {
      resolvedObject[key] = resolveVariables(input[key], context);
    }
    return resolvedObject;
  }

  return input;
}
