// src/components/orders/orders-table.tsx
'use client';

import * as React from 'react';
import type { Order } from '@/types';
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
import { Eye, Check, X, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/utils';

type Props = { orders: Order[] };

export function OrdersTable({ orders }: Props) {
  const [selected, setSelected] = React.useState<Order | null>(null);

  const statusVariant = (status: string) => {
    switch (status) {
      case 'new':
        return 'info' as const;
      case 'confirmed':
        return 'success' as const;
      case 'canceled':
        return 'destructive' as const;
      case 'review':
        return 'warning' as const;
      default:
        return 'secondary' as const;
    }
  };

  const Decision = ({ decidedBy, status }: { decidedBy?: string; status?: string }) => {
    const label = decidedBy === 'ai' ? 'AI' : decidedBy === 'human' ? 'Manual' : '—';
    const icon =
      status === 'confirmed' ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : status === 'canceled' ? (
        <X className="h-4 w-4" aria-hidden />
      ) : status === 'review' ? (
        <AlertTriangle className="h-4 w-4" aria-hidden />
      ) : null;

    // Wrap icon+label in a neutral glass chip (no hardcoded colors)
    return (
      <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs text-foreground glass">
        {icon}
        <span className="uppercase tracking-wider">{label}</span>
      </span>
    );
  };

  const totalFor = (o: Order) =>
    (o.items ?? []).reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);

  if (!orders?.length) {
    return (
      <div className="glass rounded-xl border p-6 text-center">
        <div className="text-sm text-muted-foreground">No orders found.</div>
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <Table className="min-w-[760px]">
          <TableHeader className="sticky top-0 z-[1] bg-background/70 backdrop-blur">
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Decision</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id} className="hover:bg-foreground/5">
                <TableCell className="font-mono text-xs">{order.externalKey || order.id}</TableCell>

                <TableCell>
                  <Badge variant={statusVariant(order.status)}>
                    {order.status?.toUpperCase() || 'UNKNOWN'}
                  </Badge>
                </TableCell>

                <TableCell>
                  <div className="min-w-[180px]">
                    <div className="font-medium">{order.customer?.name || 'Unknown'}</div>
                    <div className="text-xs text-muted-foreground">{order.customer?.email || '—'}</div>
                  </div>
                </TableCell>

                <TableCell className="font-medium">
                  {formatCurrency(totalFor(order))}
                </TableCell>

                <TableCell>
                  <Decision decidedBy={order.decidedBy} status={order.status} />
                </TableCell>

                <TableCell className="text-sm">
                  {formatDateTime(order.createdAt)}
                </TableCell>

                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelected(order)}
                    aria-label="View order"
                    title="View order"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>

          <TableFooter>
            <TableRow>
              <TableCell colSpan={7} className="text-right text-xs text-muted-foreground">
                Showing {orders.length} {orders.length === 1 ? 'order' : 'orders'}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {/* Placeholder for future details panel / modal */}
      {selected && (
        <div className="sr-only" aria-live="polite">
          Selected order {selected.externalKey || selected.id}
        </div>
      )}
    </div>
  );
}
