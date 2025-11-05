import { z } from 'zod';

export const ProductV1 = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional().default(''),
  price: z.number().nonnegative().optional(),
  currency: z.string().default('USD'),
  sku: z.string().optional(),
  category: z.string().optional(),
  stock: z.number().int().optional(),
  attributes: z.record(z.any()).optional(),
});

export type ProductV1 = z.infer<typeof ProductV1>;
