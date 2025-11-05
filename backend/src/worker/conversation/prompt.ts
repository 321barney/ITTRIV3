// src/worker/conversation/prompt.ts
import type { ChatMessage } from '../../ai/types';
import { preferDarija, localeTag } from '../../utils/lang';

export type ConversationState =
  | 'init'            // we just pinged the user
  | 'await_choice'    // waiting for confirm/cancel/more_info
  | 'clarify'         // asking for missing info
  | 'address_change'  // collecting new address / location
  | 'confirmed'       // order confirmed
  | 'cancelled'       // order cancelled
  | 'closed';         // done

export type PlanAction = 'ASK_CHOICE'|'CONFIRM'|'CANCEL'|'ASK_MORE_INFO'|'REQUEST_LOCATION'|'ACK_LOCATION'|'CLOSE';

export type LLMPlan = {
  action: PlanAction;
  message: string;          // short message to send back to the user
  status?: 'processing'|'completed'|'cancelled'; // map to orders.status if applicable
  need?: ('address'|'note'|'other')[];
  address_text?: string | null;
};

export function systemPrompt(storeName: string, locale: string) {
  const tag = localeTag(locale as any);
  return [
    {
      role: 'system',
      content: [
        `You are the order assistant for ${storeName}.`,
        `Keep messages VERY short (1–2 sentences). Use the user's language (${tag}).`,
        `Always drive to a decision: confirm, cancel, or ask for exactly one missing item.`,
        `Never discuss policies. If address changes are requested, ask for the live location.`,
        `When you decide, produce a JSON plan with fields: action, message, status?, need?, address_text?`,
      ].join(' ')
    }
  ] as ChatMessage[];
}

export function buildMessages(history: { role: 'user'|'assistant'; content: string }[]) {
  return history as ChatMessage[];
}
