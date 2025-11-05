// src/utils/ingest-transforms.ts

/**
 * Custom field transformations for ingestion
 * Handles special formatting, parsing, and data enrichment
 */

/**
 * Format phone number to international format
 */
export function formatPhoneInternational(phone: any, defaultCountryCode = '212'): string | null {
  if (!phone) return null;
  
  let cleaned = String(phone).trim().replace(/[\s\-().]/g, '');
  
  // Remove leading +
  if (cleaned.startsWith('+')) {
    return '+' + cleaned.substring(1);
  }
  
  // Remove leading 00
  if (cleaned.startsWith('00')) {
    return '+' + cleaned.substring(2);
  }
  
  // Remove leading 0 and add country code
  if (cleaned.startsWith('0')) {
    return '+' + defaultCountryCode + cleaned.substring(1);
  }
  
  // Add country code if missing
  if (!cleaned.startsWith(defaultCountryCode)) {
    return '+' + defaultCountryCode + cleaned;
  }
  
  return '+' + cleaned;
}

/**
 * Parse full name into first name and last name
 */
export function parseFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = String(fullName || '').trim();
  
  if (!trimmed) {
    return { firstName: '', lastName: '' };
  }
  
  const parts = trimmed.split(/\s+/);
  
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

/**
 * Parse address into components
 */
export function parseAddress(address: string): {
  street?: string;
  city?: string;
  postalCode?: string;
  country?: string;
} {
  const trimmed = String(address || '').trim();
  
  if (!trimmed) {
    return {};
  }
  
  // Try to extract postal code (5 digits)
  const postalMatch = trimmed.match(/\b\d{5}\b/);
  const postalCode = postalMatch ? postalMatch[0] : undefined;
  
  // Common Moroccan cities
  const moroccanCities = [
    'casablanca', 'rabat', 'marrakech', 'fes', 'tangier', 'agadir', 
    'meknes', 'oujda', 'kenitra', 'tetouan', 'sale', 'temara', 
    'safi', 'el jadida', 'beni mellal', 'nador', 'taza'
  ];
  
  let city: string | undefined;
  const lowerAddress = trimmed.toLowerCase();
  
  for (const cityName of moroccanCities) {
    if (lowerAddress.includes(cityName)) {
      city = cityName.charAt(0).toUpperCase() + cityName.slice(1);
      break;
    }
  }
  
  return {
    street: trimmed,
    city,
    postalCode,
    country: 'Morocco', // Default for Moroccan businesses
  };
}

/**
 * Normalize currency amounts (handle different decimal separators)
 */
export function normalizeCurrency(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  
  let str = String(value).trim();
  
  // Remove currency symbols and letters
  str = str.replace(/[^\d.,\-]/g, '');
  
  // Handle European format (1.234,56) vs US format (1,234.56)
  if (str.includes('.') && str.includes(',')) {
    if (str.indexOf('.') < str.indexOf(',')) {
      // European: . is thousands, , is decimal
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US: , is thousands, . is decimal
      str = str.replace(/,/g, '');
    }
  } else if (str.includes(',')) {
    // Single comma - assume decimal
    str = str.replace(',', '.');
  }
  
  const num = parseFloat(str);
  return Number.isFinite(num) ? num : null;
}

/**
 * Extract quantity from text (handles units)
 */
export function extractQuantity(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.floor(value) : null;
  }
  
  const str = String(value).trim().toLowerCase();
  
  // Remove units (pcs, pieces, units, etc.)
  const cleaned = str
    .replace(/\b(pcs|pieces|units|items|qty|pièces|unités)\b/gi, '')
    .replace(/[^\d.,-]/g, '')
    .trim();
  
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? Math.floor(num) : null;
}

/**
 * Clean and normalize text fields
 */
export function normalizeText(text: any): string | null {
  if (!text) return null;
  
  return String(text)
    .trim()
    .replace(/\s+/g, ' ') // Multiple spaces to single space
    .replace(/\n+/g, '\n') // Multiple newlines to single
    .trim();
}

/**
 * Detect and normalize boolean values
 */
export function normalizeBoolean(value: any): boolean {
  if (typeof value === 'boolean') return value;
  
  const str = String(value || '').toLowerCase().trim();
  
  const truthyValues = ['true', '1', 'yes', 'oui', 'y', 'ok', 'checked', 'on'];
  const falsyValues = ['false', '0', 'no', 'non', 'n', 'unchecked', 'off'];
  
  if (truthyValues.includes(str)) return true;
  if (falsyValues.includes(str)) return false;
  
  return Boolean(value);
}

/**
 * Transform SKU to standard format
 */
export function normalizeSKU(sku: any): string | null {
  if (!sku) return null;
  
  return String(sku)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-')
    .replace(/[^A-Z0-9\-_]/g, '');
}

/**
 * Apply all transformations to a record
 */
export function applyTransformations(
  record: Record<string, any>,
  config: {
    phoneFields?: string[];
    nameFields?: string[];
    addressFields?: string[];
    currencyFields?: string[];
    quantityFields?: string[];
    textFields?: string[];
    booleanFields?: string[];
    skuFields?: string[];
  } = {}
): Record<string, any> {
  const transformed: Record<string, any> = { ...record };
  
  // Phone transformations
  config.phoneFields?.forEach((field) => {
    if (transformed[field]) {
      transformed[field] = formatPhoneInternational(transformed[field]);
    }
  });
  
  // Name transformations
  config.nameFields?.forEach((field) => {
    if (transformed[field]) {
      const { firstName, lastName } = parseFullName(transformed[field]);
      transformed[`${field}_first`] = firstName;
      transformed[`${field}_last`] = lastName;
    }
  });
  
  // Address transformations
  config.addressFields?.forEach((field) => {
    if (transformed[field]) {
      const parsed = parseAddress(transformed[field]);
      transformed[`${field}_parsed`] = parsed;
    }
  });
  
  // Currency transformations
  config.currencyFields?.forEach((field) => {
    if (transformed[field] !== undefined) {
      transformed[field] = normalizeCurrency(transformed[field]);
    }
  });
  
  // Quantity transformations
  config.quantityFields?.forEach((field) => {
    if (transformed[field] !== undefined) {
      transformed[field] = extractQuantity(transformed[field]);
    }
  });
  
  // Text transformations
  config.textFields?.forEach((field) => {
    if (transformed[field]) {
      transformed[field] = normalizeText(transformed[field]);
    }
  });
  
  // Boolean transformations
  config.booleanFields?.forEach((field) => {
    if (transformed[field] !== undefined) {
      transformed[field] = normalizeBoolean(transformed[field]);
    }
  });
  
  // SKU transformations
  config.skuFields?.forEach((field) => {
    if (transformed[field]) {
      transformed[field] = normalizeSKU(transformed[field]);
    }
  });
  
  return transformed;
}

/**
 * Default transformation config for orders
 */
export const ORDER_TRANSFORM_CONFIG = {
  phoneFields: ['customer_phone', 'phone', 'telephone'],
  nameFields: ['customer_name', 'name'],
  addressFields: ['address', 'shipping_address', 'delivery_address'],
  currencyFields: ['total_amount', 'amount', 'total', 'price'],
  textFields: ['notes', 'comments', 'description'],
};

/**
 * Default transformation config for products
 */
export const PRODUCT_TRANSFORM_CONFIG = {
  currencyFields: ['price', 'cost'],
  quantityFields: ['quantity', 'stock', 'inventory'],
  textFields: ['title', 'description'],
  skuFields: ['sku'],
};
