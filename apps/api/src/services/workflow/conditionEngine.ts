export class ConditionEngine {
  static evaluate(conditionConfig: any, context: any): boolean {
    if (!conditionConfig) return true;

    // Support for { all: [...] } or { any: [...] } similar to PolicyEvaluationService
    if (conditionConfig.all && Array.isArray(conditionConfig.all)) {
      return conditionConfig.all.every((cond: any) => this.evaluateNode(cond, context));
    }
    if (conditionConfig.any && Array.isArray(conditionConfig.any)) {
      return conditionConfig.any.some((cond: any) => this.evaluateNode(cond, context));
    }

    // Single condition
    return this.evaluateNode(conditionConfig, context);
  }

  private static evaluateNode(cond: any, context: any): boolean {
    const { field, operator, value } = cond;
    if (!field || !operator) return false;

    let actualValue = this.getNestedValue(context, field);

    switch (operator) {
      case 'EQUALS': return actualValue === value;
      case 'NOT_EQUALS': return actualValue !== value;
      case 'GREATER_THAN': return actualValue > value;
      case 'GREATER_THAN_OR_EQUAL': return actualValue >= value;
      case 'LESS_THAN': return actualValue < value;
      case 'LESS_THAN_OR_EQUAL': return actualValue <= value;
      case 'IN': return Array.isArray(value) && value.includes(actualValue);
      case 'NOT_IN': return Array.isArray(value) && !value.includes(actualValue);
      case 'EXISTS': return actualValue !== undefined && actualValue !== null;
      case 'NOT_EXISTS': return actualValue === undefined || actualValue === null;
      case 'CONTAINS': return typeof actualValue === 'string' && typeof value === 'string' && actualValue.includes(value);
      default: return false;
    }
  }

  private static getNestedValue(obj: any, path: string): any {
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
