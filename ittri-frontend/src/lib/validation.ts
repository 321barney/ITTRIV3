import { z } from 'zod';

export const schemas = {
  login: z.object({
    email: z.string().email('Invalid email format'),
    password: z.string().min(1, 'Password required').optional(),
    adminKey: z.string().min(1, 'Admin key required').optional(),
  }).refine(data => data.password || data.adminKey, {
    message: "Either password or admin key is required",
    path: ["password"]
  }),

  register: z.object({
    email: z.string().email('Invalid email format'),
    companyName: z.string().min(2, 'Company name must be at least 2 characters'),
    sellerName: z.string().min(2, 'Seller name required').optional(),
    phoneNumber: z.string().regex(/^\+?[\d\s\-()]{10,}$/, 'Invalid phone number').optional(),
    storeName: z.string().min(2, 'Store name required').optional(),
    adminKey: z.string().min(8, 'Admin key must be at least 8 characters').optional(),
    planCode: z.enum(['starter', 'pro', 'enterprise']).default('starter'),
    whatsappApi: z.string().url('Invalid WhatsApp API URL').optional().nullable(),
    gsheetUrl: z.string().url('Invalid Google Sheets URL').regex(/docs\.google\.com\/spreadsheets/, 'Must be a Google Sheets URL').optional().nullable(),
  }),

  refresh: z.object({}),
  logout: z.object({}),
  me: z.object({}),
};

export type ValidationSchemas = typeof schemas;
export type LoginInput = z.infer<typeof schemas.login>;
export type RegisterInput = z.infer<typeof schemas.register>;

export function validateRequest<T extends keyof ValidationSchemas>(
  operation: T,
  data: unknown
): { success: true; data: z.infer<ValidationSchemas[T]> } | { success: false; errors: any[] } {
  const result = schemas[operation].safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: result.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
      code: err.code
    }))
  };
}
