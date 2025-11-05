// src/components/conversations/conversation-list.tsx
'use client';

import * as React from 'react';
import type { Conversation } from '@/types';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/utils';
import { MessageSquare } from 'lucide-react';

type Props = {
  conversations: Conversation[];
  activeConversation?: Conversation | null;
  onSelectConversation: (c: Conversation) => void;
};

const statusToVariant = (status?: string) => {
  const s = (status || '').toLowerCase();
  if (s === 'closed') return 'secondary';
  if (s === 'escalated') return 'destructive';
  return 'default';
};

export function ConversationList({
  conversations,
  activeConversation,
  onSelectConversation,
}: Props) {
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>, c: Conversation) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectConversation(c);
    }
  };

  return (
    <div role="list" className="space-y-2">
      {conversations.map((c) => {
        const isActive = activeConversation?.id === c.id;
        const last = c.messages?.[Math.max(0, (c.messages?.length ?? 1) - 1)];
        const preview =
          (last?.content || '').slice(0, 120) + ((last?.content?.length ?? 0) > 120 ? '…' : '');

        return (
          <div
            key={c.id}
            role="listitem"
            aria-selected={isActive || undefined}
            tabIndex={0}
            onClick={() => onSelectConversation(c)}
            onKeyDown={(e) => onKey(e, c)}
            className={[
              'glass border rounded-xl p-4 cursor-pointer transition-all duration-200',
              'hover:bg-foreground/5 focus-neon',
              isActive ? 'ring-1 ring-ring/40 bg-foreground/5' : '',
            ].join(' ')}
          >
            <div className="flex items-start gap-3">
              <div className="glass inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <MessageSquare className="h-4 w-4 text-foreground/80" aria-hidden />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">
                    {c.customer?.name || 'Anonymous'}
                  </span>
                  <Badge variant={statusToVariant(c.status)} className="uppercase">
                    {(c.status || 'open').toUpperCase()}
                  </Badge>
                </div>

                <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                  {preview || 'No messages yet.'}
                </p>

                <p className="mt-2 text-xs text-muted-foreground">
                  {formatDateTime(c.updatedAt)} • {c.origin || 'unknown'}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
