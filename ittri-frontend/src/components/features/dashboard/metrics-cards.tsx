// src/components/dashboard/metrics-cards.tsx
'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, ShoppingCart, MessageSquare, Clock } from 'lucide-react';

export interface DashboardMetrics {
  totalOrders: number;
  totalRevenue: number;
  aiConfirmationRate: number;  // 0..1
  avgResponseTime: number;     // minutes (unused in the 4 cards below)
  activeConversations: number;
}

type MetricCard = {
  title: string;
  value: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  trend: string; // e.g. "+12.5%" or "-2.1%"
};

function Trend({
  trend,
  className,
}: {
  trend: string;
  className?: string;
}) {
  // parse sign
  const n = Number(trend.replace(/[^\d.-]/g, ''));
  const positive = !Number.isNaN(n) && n > 0;
  const negative = !Number.isNaN(n) && n < 0;

  // token-based color (no hardcoded palette)
  const color = positive
    ? `rgba(var(--ring-rgb), .95)`
    : negative
    ? `rgba(var(--destructive-rgb), .95)`
    : `rgba(var(--muted-foreground-rgb), 1)`;

  const arrow = positive ? '▲' : negative ? '▼' : '■';

  return (
    <p
      className={['text-xs', className].filter(Boolean).join(' ')}
      style={{ color }}
    >
      {arrow} {trend} from last month
    </p>
  );
}

export function MetricsCards({ metrics }: { metrics: DashboardMetrics }) {
  const cards: MetricCard[] = [
    {
      title: 'Total Revenue',
      value: formatCurrency(metrics.totalRevenue),
      icon: TrendingUp,
      trend: '+12.5%',
    },
    {
      title: 'Total Orders',
      value: metrics.totalOrders.toLocaleString(),
      icon: ShoppingCart,
      trend: '+8.2%',
    },
    {
      title: 'Active Conversations',
      value: String(metrics.activeConversations),
      icon: MessageSquare,
      trend: '-2.1%',
    },
    {
      title: 'AI Confirmation Rate',
      value: `${(metrics.aiConfirmationRate * 100).toFixed(1)}%`,
      icon: Clock,
      trend: '+5.4%',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => {
        const Icon = card.icon;
        return (
          <Card key={card.title} className="focus-neon">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[13px] font-semibold tracking-wide text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className="glass inline-flex h-9 w-9 items-center justify-center rounded-xl">
                <Icon className="h-4 w-4 text-foreground/80" aria-hidden />
              </div>
            </CardHeader>
            <CardContent>
              <div className="gradient-text-triple text-2xl font-bold leading-tight">
                {card.value}
              </div>
              <Trend trend={card.trend} className="mt-1" />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
