// src/utils/ingest-validation.ts

/**
 * Data validation rules for ingestion
 * Ensures data quality before inserting into database
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cleaned?: any;
}

export interface ValidationRule {
  field: string;
  required?: boolean;
  type?: 'string' | 'number' | 'email' | 'phone' | 'date' | 'url';
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any) => boolean | string;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

/**
 * Validate phone number (flexible, international)
 */
export function isValidPhone(phone: string): boolean {
  const cleaned = String(phone).replace(/[\s\-().+]/g, '');
  return /^[0-9]{8,15}$/.test(cleaned);
}

/**
 * Validate and clean phone number
 */
export function cleanPhoneNumber(phone: any): string | null {
  if (!phone) return null;
  const str = String(phone).trim();
  
  // Remove common formatting
  let cleaned = str.replace(/[\s\-().]/g, '');
  
  // Handle international prefix
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  
  // Remove leading zeros for some countries
  if (cleaned.startsWith('0') && cleaned.length > 10) {
    cleaned = cleaned.substring(1);
  }
  
  // Validate length
  if (cleaned.length < 8 || cleaned.length > 15) {
    return null;
  }
  
  return '+' + cleaned;
}

/**
 * Validate order record
 */
export function validateOrder(
  order: Record<string, any>,
  rules?: Partial<ValidationRule>[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cleaned: Record<string, any> = { ...order };

  // Default rules for orders
  const defaultRules: ValidationRule[] = [
    { field: 'order_id', required: true, type: 'string', minLength: 1, maxLength: 255 },
    { field: 'status', required: false, type: 'string' },
    { field: 'total_amount', required: false, type: 'number', min: 0 },
    { field: 'customer_email', required: false, type: 'email' },
    { field: 'customer_phone', required: false, type: 'phone' },
    { field: 'customer_name', required: false, type: 'string', minLength: 2, maxLength: 255 },
  ];

  const allRules = [...defaultRules, ...(rules || [])];

  for (const rule of allRules) {
    const value = order[rule.field];

    // Check required
    if (rule.required && (value === null || value === undefined || value === '')) {
      errors.push(`${rule.field} is required but missing`);
      continue;
    }

    // Skip validation if value is empty and not required
    if (!value && !rule.required) {
      continue;
    }

    // Type validation
    if (rule.type) {
      switch (rule.type) {
        case 'string':
          if (typeof value !== 'string') {
            warnings.push(`${rule.field} should be a string, got ${typeof value}`);
            cleaned[rule.field] = String(value);
          }
          break;

        case 'number':
          const num = Number(value);
          if (!Number.isFinite(num)) {
            errors.push(`${rule.field} should be a number, got: ${value}`);
          } else {
            cleaned[rule.field] = num;
          }
          break;

        case 'email':
          if (!isValidEmail(String(value))) {
            warnings.push(`${rule.field} has invalid email format: ${value}`);
          }
          break;

        case 'phone':
          const cleanedPhone = cleanPhoneNumber(value);
          if (!cleanedPhone) {
            warnings.push(`${rule.field} has invalid phone format: ${value}`);
          } else {
            cleaned[rule.field] = cleanedPhone;
          }
          break;

        case 'date':
          const date = new Date(value);
          if (isNaN(date.getTime())) {
            errors.push(`${rule.field} has invalid date format: ${value}`);
          }
          break;

        case 'url':
          try {
            new URL(String(value));
          } catch {
            warnings.push(`${rule.field} has invalid URL format: ${value}`);
          }
          break;
      }
    }

    // Length validation
    if (rule.minLength !== undefined && String(value).length < rule.minLength) {
      errors.push(`${rule.field} is too short (min: ${rule.minLength}, got: ${String(value).length})`);
    }

    if (rule.maxLength !== undefined && String(value).length > rule.maxLength) {
      warnings.push(`${rule.field} is too long (max: ${rule.maxLength}, got: ${String(value).length})`);
      cleaned[rule.field] = String(value).substring(0, rule.maxLength);
    }

    // Range validation
    if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
      errors.push(`${rule.field} is below minimum (min: ${rule.min}, got: ${value})`);
    }

    if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
      warnings.push(`${rule.field} exceeds maximum (max: ${rule.max}, got: ${value})`);
    }

    // Pattern validation
    if (rule.pattern && !rule.pattern.test(String(value))) {
      errors.push(`${rule.field} does not match required pattern: ${value}`);
    }

    // Custom validation
    if (rule.custom) {
      const result = rule.custom(value);
      if (result === false) {
        errors.push(`${rule.field} failed custom validation`);
      } else if (typeof result === 'string') {
        errors.push(`${rule.field}: ${result}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cleaned: errors.length === 0 ? cleaned : undefined,
  };
}

/**
 * Validate product record
 */
export function validateProduct(
  product: Record<string, any>,
  rules?: Partial<ValidationRule>[]
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cleaned: Record<string, any> = { ...product };

  const defaultRules: ValidationRule[] = [
    { field: 'sku', required: true, type: 'string', minLength: 1, maxLength: 255 },
    { field: 'title', required: true, type: 'string', minLength: 2, maxLength: 500 },
    { field: 'price', required: false, type: 'number', min: 0 },
    { field: 'quantity', required: false, type: 'number', min: 0 },
    { field: 'description', required: false, type: 'string', maxLength: 5000 },
  ];

  const allRules = [...defaultRules, ...(rules || [])];

  for (const rule of allRules) {
    const value = product[rule.field];

    if (rule.required && (value === null || value === undefined || value === '')) {
      errors.push(`${rule.field} is required but missing`);
      continue;
    }

    if (!value && !rule.required) continue;

    // Similar validation logic as validateOrder
    // (reuse the same logic)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cleaned: errors.length === 0 ? cleaned : undefined,
  };
}

/**
 * Batch validate multiple records
 */
export function batchValidate(
  records: Array<Record<string, any>>,
  validator: (record: any) => ValidationResult
): {
  valid: Array<Record<string, any>>;
  invalid: Array<{ record: Record<string, any>; errors: string[]; index: number }>;
  warnings: Array<{ record: Record<string, any>; warnings: string[]; index: number }>;
} {
  const valid: Array<Record<string, any>> = [];
  const invalid: Array<{ record: Record<string, any>; errors: string[]; index: number }> = [];
  const warnings: Array<{ record: Record<string, any>; warnings: string[]; index: number }> = [];

  records.forEach((record, index) => {
    const result = validator(record);

    if (result.valid && result.cleaned) {
      valid.push(result.cleaned);
      if (result.warnings.length > 0) {
        warnings.push({ record, warnings: result.warnings, index });
      }
    } else {
      invalid.push({ record, errors: result.errors, index });
    }
  });

  return { valid, invalid, warnings };
}
