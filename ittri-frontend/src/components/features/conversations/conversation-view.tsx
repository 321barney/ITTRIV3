// src/components/conversations/conversation-view.tsx
'use client';

import * as React from 'react';
import type { Conversation } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTime } from '@/lib/utils';
import { Send, Bot, User } from 'lucide-react';

type Props = {
  conversation: Conversation;
  onSendMessage: (content: string) => void;
};

export function ConversationView({ conversation, onSendMessage }: Props) {
  const [value, setValue] = React.useState('');
  const scrollerRef = React.useRef<HTMLDivElement>(null);

  // auto-scroll to bottom on new messages
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [conversation?.messages?.length]);

  const send = React.useCallback(() => {
    const msg = value.trim();
    if (!msg) return;
    onSendMessage(msg);
    setValue('');
  }, [value, onSendMessage]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const RoleIcon = ({ role }: { role: string }) =>
    role === 'assistant'
      ? <Bot className="h-4 w-4 text-foreground/80" aria-hidden />
      : <User className="h-4 w-4 text-foreground/80" aria-hidden />;

  return (
    <section className="flex h-full min-h-[480px] flex-col rounded-2xl border glass">
      {/* Header */}
      <header className="flex items-center justify-between border-b p-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-foreground">
            {conversation.customer?.name || 'Anonymous Customer'}
          </h3>
          <p className="text-xs text-muted-foreground">
            {conversation.customer?.email || '—'} • {conversation.origin || 'unknown'}
          </p>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {conversation.messages.map((m) => {
          const mine = m.role !== 'assistant';
          return (
            <div
              key={m.id}
              className={[
                'flex items-start gap-3',
                mine ? 'flex-row-reverse' : 'flex-row',
              ].join(' ')}
            >
              {/* avatar */}
              <div className="glass inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <RoleIcon role={m.role} />
              </div>

              {/* bubble */}
              <div
                className={[
                  'max-w-[72%] rounded-xl px-3 py-2',
                  mine
                    ? 'bg-primary text-primary-foreground'
                    : 'glass',
                ].join(' ')}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDateTime(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <footer className="border-t p-4">
        <label htmlFor="chat-input" className="sr-only">Type your message</label>
        <div className="flex items-center gap-2">
          <Input
            id="chat-input"
            placeholder="Type your message…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Message input"
          />
          <Button
            onClick={send}
            disabled={!value.trim()}
            className="rounded-xl"
            aria-label="Send message"
            title="Send (Enter)"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Press Enter to send • Shift+Enter for a new line
        </p>
      </footer>
    </section>
  );
}
