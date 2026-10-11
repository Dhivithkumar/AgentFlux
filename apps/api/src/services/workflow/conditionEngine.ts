export interface ConditionNode {
  field?: string;
  operator?: string;
  value?: any;
  all?: (ConditionNode | any)[];
  any?: (ConditionNode | any)[];
}

export interface BranchRule {
  route: string;
  condition?: ConditionNode | any;
}

export class ConditionEngine {
  /**
   * Evaluates a condition configuration (single rule, all, any, or nested) against context.
   */
  static evaluate(conditionConfig: any, context: any): boolean {
    if (!conditionConfig || Object.keys(conditionConfig).length === 0) return true;

    // Direct boolean
    if (typeof conditionConfig === 'boolean') return conditionConfig;

    // Support nested "all" rule groups
    if (conditionConfig.all && Array.isArray(conditionConfig.all)) {
      if (conditionConfig.all.length === 0) return true;
      return conditionConfig.all.every((cond: any) => this.evaluate(cond, context));
    }

    // Support nested "any" rule groups
    if (conditionConfig.any && Array.isArray(conditionConfig.any)) {
      if (conditionConfig.any.length === 0) return false;
      return conditionConfig.any.some((cond: any) => this.evaluate(cond, context));
    }

    // Single condition leaf
    return this.evaluateLeaf(conditionConfig, context);
  }

  /**
   * Evaluates multi-branch routes.
   * If config has `branches` array: returns the first matching branch route.
   * Otherwise returns 'YES' if evaluate() is true, else 'NO'.
   */
  static evaluateBranch(config: any, context: any): string {
    if (!config) return 'YES';

    if (Array.isArray(config.branches) && config.branches.length > 0) {
      for (const branch of config.branches) {
        if (!branch.condition || this.evaluate(branch.condition, context)) {
          return branch.route || 'DEFAULT';
        }
      }
      return config.defaultRoute || 'DEFAULT';
    }

    // Standard binary condition
    const passes = this.evaluate(config.condition || config, context);
    return passes ? 'YES' : 'NO';
  }

  private static evaluateLeaf(cond: any, context: any): boolean {
    let { field, operator, value } = cond;
    if (!field || !operator) return true;

    // Clean up {{variable}} syntax if user provided template tags in field name
    field = field.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');

    // Resolve actual value across context layers
    const actualValue = this.resolveFieldValue(context, field);

    // If expected value is a variable template string e.g. {{config.maxAmount}}, resolve it
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const varPath = value.slice(2, -2).trim();
      value = this.resolveFieldValue(context, varPath);
    }

    return this.applyOperator(operator.toUpperCase(), actualValue, value);
  }

  private static applyOperator(operator: string, actual: any, expected: any): boolean {
    switch (operator) {
      case 'EQUALS':
      case '==':
      case '===':
        return this.looseEquals(actual, expected);

      case 'NOT_EQUALS':
      case '!=':
      case '!==':
        return !this.looseEquals(actual, expected);

      case 'GREATER_THAN':
      case '>':
        return this.toNumber(actual) > this.toNumber(expected);

      case 'GREATER_THAN_OR_EQUAL':
      case '>=':
        return this.toNumber(actual) >= this.toNumber(expected);

      case 'LESS_THAN':
      case '<':
        return this.toNumber(actual) < this.toNumber(expected);

      case 'LESS_THAN_OR_EQUAL':
      case '<=':
        return this.toNumber(actual) <= this.toNumber(expected);

      case 'IN':
        if (Array.isArray(expected)) return expected.some(e => this.looseEquals(e, actual));
        if (typeof expected === 'string') return expected.includes(String(actual));
        return false;

      case 'NOT_IN':
        if (Array.isArray(expected)) return !expected.some(e => this.looseEquals(e, actual));
        if (typeof expected === 'string') return !expected.includes(String(actual));
        return true;

      case 'EXISTS':
        return actual !== undefined && actual !== null && actual !== '';

      case 'NOT_EXISTS':
        return actual === undefined || actual === null || actual === '';

      case 'IS_EMPTY':
        if (actual === undefined || actual === null) return true;
        if (typeof actual === 'string' || Array.isArray(actual)) return actual.length === 0;
        if (typeof actual === 'object') return Object.keys(actual).length === 0;
        return false;

      case 'NOT_EMPTY':
        return !this.applyOperator('IS_EMPTY', actual, expected);

      case 'CONTAINS':
        if (typeof actual === 'string') return actual.toLowerCase().includes(String(expected).toLowerCase());
        if (Array.isArray(actual)) return actual.some(a => this.looseEquals(a, expected));
        return false;

      case 'NOT_CONTAINS':
        return !this.applyOperator('CONTAINS', actual, expected);

      case 'STARTS_WITH':
        return typeof actual === 'string' && actual.startsWith(String(expected));

      case 'ENDS_WITH':
        return typeof actual === 'string' && actual.endsWith(String(expected));

      case 'IS_TRUE':
        return actual === true || actual === 'true' || actual === 1;

      case 'IS_FALSE':
        return actual === false || actual === 'false' || actual === 0;

      case 'MATCHES':
      case 'REGEX':
        try {
          const reg = new RegExp(String(expected), 'i');
          return reg.test(String(actual));
        } catch {
          return false;
        }

      default:
        console.warn(`[ConditionEngine] Unknown operator: ${operator}`);
        return false;
    }
  }

  private static looseEquals(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || a === undefined || b === null || b === undefined) return a == b;
    // Numeric string comparison
    if (!isNaN(Number(a)) && !isNaN(Number(b))) {
      return Number(a) === Number(b);
    }
    // Boolean string comparison
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      return String(a).toLowerCase() === String(b).toLowerCase();
    }
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  private static toNumber(val: any): number {
    const num = Number(val);
    return isNaN(num) ? 0 : num;
  }

  public static resolveFieldValue(root: any, path: string): any {
    if (!root) return undefined;

    // 1. Try directly on root
    let val = this.getNestedValue(root, path);
    if (val !== undefined) return val;

    // 2. Try on root.context if wrapped
    if (root.context) {
      val = this.getNestedValue(root.context, path);
      if (val !== undefined) return val;
    }

    // 3. Try on root.input
    if (root.input) {
      val = this.getNestedValue(root.input, path);
      if (val !== undefined) return val;
    }

    // 4. Try on root.trigger or root.event
    if (root.trigger) {
      val = this.getNestedValue(root.trigger, path);
      if (val !== undefined) return val;
    }
    if (root.event) {
      val = this.getNestedValue(root.event, path);
      if (val !== undefined) return val;
    }

    // 5. If root.context.trigger or root.context.steps exist
    if (root.context?.trigger) {
      val = this.getNestedValue(root.context.trigger, path);
      if (val !== undefined) return val;
    }
    if (root.context?.steps) {
      val = this.getNestedValue(root.context.steps, path);
      if (val !== undefined) return val;
    }
    if (root.context?.variables) {
      val = this.getNestedValue(root.context.variables, path);
      if (val !== undefined) return val;
    }

    return undefined;
  }

  public static getNestedValue(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') return undefined;

    return path.split('.').reduce((acc, part) => {
      if (acc === null || acc === undefined) return undefined;
      const arrayMatch = part.match(/(.*)\[(\d+)\]$/);
      if (arrayMatch) {
        const prop = arrayMatch[1];
        const index = parseInt(arrayMatch[2], 10);
        return prop === '' ? acc[index] : acc[prop]?.[index];
      }
      return acc[part];
    }, obj);
  }
}

