// components/ChatInterface.tsx
"use client";

import React, { useRef, useEffect } from "react";
import { Bot, User, Send, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMessage } from "@/hooks/use-chat-sessions";
import { cn } from "@/lib/utils";

interface ChatInterfaceProps {
  messages: ChatMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  mode: "codegen" | "chat";
}

export function ChatInterface({
  messages,
  input,
  onInputChange,
  onSend,
  onStop,
  streaming,
  mode,
}: ChatInterfaceProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="card-futuristic rounded-2xl p-6 space-y-4">
      {/* Scroll area */}
      <div
        ref={scrollerRef}
        className="h-[450px] overflow-y-auto pr-2 custom-scrollbar space-y-4"
      >
        {messages.map((m, i) => {
          const isUser = m.role === "user";
          return (
            <div
              key={m.timestamp}
              className={cn(
                "flex gap-3 items-start",
                isUser ? "flex-row-reverse" : "flex-row"
              )}
            >
              {/* Avatar */}
              <div
                className={cn(
                  "w-8 h-8 rounded-full grid place-items-center shrink-0",
                  "glass"
                )}
                aria-hidden
              >
                {isUser ? (
                  <User className="w-5 h-5 text-foreground" />
                ) : (
                  <Bot className="w-5 h-5 text-foreground" />
                )}
              </div>

              {/* Bubble */}
              <div className={cn("flex-1", isUser && "flex justify-end")}>
                <div
                  className={cn(
                    "inline-block max-w-[85%] rounded-2xl px-4 py-3",
                    isUser
                      ? // user bubble uses primary tokens (no hard-coded colors)
                        "bg-primary text-primary-foreground shadow"
                      : // assistant bubble uses glass surface
                        "glass"
                  )}
                >
                  <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                  <p className="text-[11px] mt-1 text-muted-foreground">
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <div>
        <label className="mb-2 block text-xs font-semibold text-muted-foreground">
          {mode === "codegen" ? "Describe your landing page" : "Chat message"}
        </label>
        <Textarea
          rows={4}
          placeholder={
            mode === "codegen" ? "Modern SaaS landing..." : "Ask anything..."
          }
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          className="focus-neon"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        {!streaming ? (
          <Button
            onClick={onSend}
            disabled={!input.trim()}
            className="rounded-xl"
          >
            <Send className="mr-2 h-4 w-4" />
            {mode === "codegen" ? "Generate" : "Send"}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onStop} className="rounded-xl">
            <StopCircle className="mr-2 h-4 w-4" />
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
