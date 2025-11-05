import { z } from 'zod';

// Common primitives
export const Id = z.union([z.string().min(1), z.number().int()]);
export const Email = z.string().email();
export const Pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

// Auth
export const LoginSchema = z.object({
  email: Email,
  password: z.string().min(8).max(256),
  login_type: z.enum(['user', 'seller']).optional(),
});

export const RegisterSchema = z.object({
  email: Email,
  password: z.string().min(8).max(256),
  name: z.string().min(1).max(120).optional(),
});

// Orders/products/sellers — minimal placeholders; extend as needed
export const CreateOrder = z.object({
  store_id: Id,
  product_id: Id,
  qty: z.coerce.number().int().min(1),
});

export const CreateProduct = z.object({
  name: z.string().min(1).max(200),
  price: z.coerce.number().min(0),
  sku: z.string().min(1).max(64).optional(),
});

export const UpdateSeller = z.object({
  company_name: z.string().min(1).max(200).optional(),
  plan_code: z.enum(['starter','pro','enterprise']).optional(),
});
