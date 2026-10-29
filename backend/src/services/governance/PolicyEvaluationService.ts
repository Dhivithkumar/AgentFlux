export interface ApprovalRuleCondition {
  all?: ApprovalRuleConditionElement[];
  any?: ApprovalRuleConditionElement[];
}

export interface ApprovalRuleConditionElement {
  field: string;
  operator: string;
  value: any;
}

export class PolicyEvaluationService {
  public static evaluate(condition: ApprovalRuleCondition | any, context: Record<string, any>): boolean {
    if (!condition) return true;

    if (condition.all && Array.isArray(condition.all)) {
      return condition.all.every((el: ApprovalRuleConditionElement) => this.evaluateElement(el, context));
    }

    if (condition.any && Array.isArray(condition.any)) {
      return condition.any.some((el: ApprovalRuleConditionElement) => this.evaluateElement(el, context));
    }

    // Default to true if empty object
    return true;
  }

  private static evaluateElement(el: ApprovalRuleConditionElement, context: Record<string, any>): boolean {
    const { field, operator, value } = el;
    const actualValue = this.getNestedValue(context, field);

    switch (operator) {
      case 'EQUALS':
        return actualValue === value;
      case 'NOT_EQUALS':
        return actualValue !== value;
      case 'GREATER_THAN':
        return typeof actualValue === 'number' && actualValue > value;
      case 'GREATER_THAN_OR_EQUAL':
        return typeof actualValue === 'number' && actualValue >= value;
      case 'LESS_THAN':
        return typeof actualValue === 'number' && actualValue < value;
      case 'LESS_THAN_OR_EQUAL':
        return typeof actualValue === 'number' && actualValue <= value;
      case 'IN':
        return Array.isArray(value) && value.includes(actualValue);
      case 'NOT_IN':
        return Array.isArray(value) && !value.includes(actualValue);
      case 'IS_EMPTY':
        return actualValue === null || actualValue === undefined || actualValue === '';
      case 'IS_NOT_EMPTY':
        return actualValue !== null && actualValue !== undefined && actualValue !== '';
      default:
        return false;
    }
  }

  private static getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
  }
}
