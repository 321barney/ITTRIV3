// src/components/products/products-table.tsx
'use client';

import * as React from 'react';
import type { Product } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Edit, Trash2, Package } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

type Props = {
  products: Product[];
  onEdit?: (p: Product) => void;
  onDelete?: (p: Product) => void;
};

export function ProductsTable({ products, onEdit, onDelete }: Props) {
  const statusVariant = (status?: string) => {
    switch ((status || '').toLowerCase()) {
      case 'active':
        return 'success' as const;
      case 'inactive':
        return 'secondary' as const;
      case 'out_of_stock':
        return 'destructive' as const;
      default:
        return 'outline' as const;
    }
  };

  if (!products?.length) {
    return (
      <div className="glass rounded-xl border p-6 text-center">
        <div className="text-sm text-muted-foreground">No products found.</div>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <Table className="min-w-[840px]">
          <TableHeader className="sticky top-0 z-[1] bg-background/70 backdrop-blur">
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Inventory</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {products.map((p) => (
              <TableRow key={p.id} className="hover:bg-foreground/5">
                <TableCell className="font-mono text-xs">{p.sku || '—'}</TableCell>

                <TableCell>
                  <div className="flex items-center gap-3 min-w-[220px]">
                    <div className="h-8 w-8 rounded-lg grid place-items-center glass">
                      <Package className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.title || 'Untitled product'}</div>
                      {p.subtitle ? (
                        <div className="truncate text-xs text-muted-foreground">{p.subtitle}</div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>

                <TableCell className="font-medium">
                  {formatCurrency(Number(p.price ?? 0), p.currency)}
                </TableCell>

                <TableCell className="text-sm">
                  {p.inventory != null ? p.inventory : 'N/A'}
                </TableCell>

                <TableCell>
                  <Badge variant={statusVariant(p.status)}>
                    {(p.status || 'unknown').replace('_', ' ').toUpperCase()}
                  </Badge>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit?.(p)}
                      aria-label="Edit product"
                      title="Edit product"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete?.(p)}
                      aria-label="Delete product"
                      title="Delete product"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>

          <TableFooter>
            <TableRow>
              <TableCell colSpan={6} className="text-right text-xs text-muted-foreground">
                Showing {products.length} {products.length === 1 ? 'product' : 'products'}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
