// src/worker/conversation.ts
import type { FastifyBaseLogger } from 'fastify';
import type { Knex } from 'knex';

import {
  ensureInProcessConversationWorker,
  type ConvoJob,
  type ConvoHandlerResult,
} from '../utils/worker-bus-conversation';

import { getClient as getLLMClient, getProviderName } from '../ai/llm';
import type { ChatMessage } from '../ai/types';

import { systemPrompt, type LLMPlan } from './conversation/prompt';

import { sendWhatsAppText, sendWhatsAppChoices } from '../utils/whatsappClient';
import { preferDarija } from '../utils/lang';
import {
  RUN_WORKERS,
  WHATSAPP_ENABLED,
  isWhatsAppEnvConfigured,
} from '../utils/flags';

type DB = Knex;

/* --------------------------------- utils ---------------------------------- */

function maskPhone(p: string): string {
  const s = (p || '').trim();
  if (s.length < 6) return s ? '***' : s;
  const last = s.slice(-4);
  return `${s.slice(0, 2)}******${last}`;
}

function nowMs() { return Date.now(); }
function msSince(t0: number) { return Date.now() - t0; }

/* --------------------------------- queries -------------------------------- */

async function getStore(trx: DB, id: string) {
  return trx('stores').where({ id }).first();
}

/** Unprocessed = status is NULL/empty OR 'new'. Always normalize to 'new' before messaging. */
async function getUnprocessedOrders(trx: DB, store_id: string, limit = 50) {
  return trx('orders')
    .select('*')
    .where({ store_id })
    .andWhere((qb) =>
      qb
        .whereNull('status')
        .orWhere('status', 'new')
        .orWhereRaw("trim(coalesce(status::text,'')) = ''")
    )
    .orderBy('created_at', 'asc')
    .limit(limit);
}

/** conversations.metadata holds { order_id, ... } (no dedicated column in v2.3) */
async function getOrCreateConversationForOrder(
  trx: DB,
  store_id: string,
  order_id: string,
  customer_id: string | null
) {
  const existing = await trx('conversations')
    .where({ store_id })
    .andWhereRaw("(metadata->>'order_id')::uuid = ?", [order_id])
    .orderBy('created_at', 'asc')
    .first();
  if (existing) return existing;

  const [row] = await trx('conversations')
    .insert({
      store_id,
      customer_id,
      origin: 'whatsapp',
      status: 'open',
      // seller_id is auto-set by trigger app.sync_conversation_seller()
      metadata: {
        state: 'init',
        order_id,
        address_ok: false,
        address_needed: false,
      },
    })
    .returning('*');
  return row;
}

async function addMessage(
  trx: DB,
  conversation_id: string,
  role: 'user' | 'assistant',
  content: string,
  metadata: any = {},
  log?: FastifyBaseLogger
) {
  await trx('messages').insert({ conversation_id, role, content, metadata });
  log?.debug(
    { conversation_id, role, len: content?.length ?? 0 },
    'conversation_message_persisted'
  );
}

/* ------------------------------ language/WA ------------------------------- */

function localeFromStore(store: any): 'fr' | 'en' | 'ar' | 'ary' {
  const meta = store?.metadata || {};
  const storeLang = (meta.lang || meta.language || meta.locale || '')
    .toLowerCase()
    .trim();
  if (/fr|fr[-_]/i.test(storeLang)) return 'fr';
  if (/ary|darija|ma|morocco/.test(storeLang)) return 'ary';
  if (/ar|ar[-_]/.test(storeLang)) return preferDarija(storeLang) ? 'ary' : 'ar';
  return 'en';
}

/** Light language detection on inbound free text: per *conversation*, not store. */
function detectPreferredLocaleFromText(text: string): 'fr' | 'en' | 'ar' | 'ary' | null {
  const t = (text || '').trim();

  // Heuristics
  const hasArabic = /[\u0600-\u06FF]/.test(t);

  // Signal words
  const frWords = /\b(bonjour|salut|confirm(er)?|annuler|plus d'?info|fran(ç|c)ais)\b/i;
  const enWords = /\b(hi|hello|confirm|cancel|more info|english)\b/i;

  // Darija (Arabic letters)
  const darijaAr = /(واش|بغيت|مزيان|شكرا|فين|عافاك)/; // wach, bghit, mzyan, shukran, fin, 3afak
  // Darija (Latin transliteration)
  const darijaLat = /\b(wach|bghit|mzyan|safi|z3ma|choukran|3afak)\b/i;

  if (hasArabic) {
    if (darijaAr.test(t)) return 'ary';
    return 'ar';
  }
  if (darijaLat.test(t)) return 'ary';
  if (frWords.test(t)) return 'fr';
  if (enWords.test(t)) return 'en';

  // Fallback: nothing confident
  return null;
}

/** WhatsApp availability: ENV only fallback allowed (no other channels). */
async function hasWhatsAppForStore(_trx: DB, _store_id: string): Promise<boolean> {
  return WHATSAPP_ENABLED && isWhatsAppEnvConfigured();
}

async function bumpConversationMetric(trx: DB, seller_id: string, store_id: string, log?: FastifyBaseLogger) {
  await trx.raw(
    'select app.upsert_metrics_day(?, ?, current_date, ?, ?, ?, ?, ?)',
    [seller_id, store_id, 0, 1, 0, 0, 0]
  );
  log?.debug({ seller_id, store_id }, 'metrics_conversation_bumped');
}

function languageHint(locale: 'fr' | 'en' | 'ar' | 'ary'): string {
  if (locale === 'fr') {
    return "\n\nRépondez avec votre langue préférée (Français / العربية / English).";
  }
  if (locale === 'ar' || locale === 'ary') {
    return "\n\nجاوبنا باللغة اللي كتفضل (العربية / الدارجة / Français / English).";
  }
  return "\n\nReply with your preferred language (English / Français / العربية).";
}

function defaultPromptByLocale(locale: 'fr' | 'en' | 'ar' | 'ary'): string {
  if (locale === 'fr') return 'Merci de choisir : ✅ Confirmer, ❌ Annuler, ou ❓ Plus d’info.';
  if (locale === 'ar' || locale === 'ary') return 'اختار من فضلك: ✅ نأكد، ❌ نلغي، ولا ❓ مزيد المعلومات.';
  return 'Please choose: ✅ Confirm, ❌ Cancel, or ❓ More info.';
}

/* ---------------------------- outbound bootstrap -------------------------- */

async function initialOutboundPing(
  trx: DB,
  store: any,
  order: any,
  convo: any,
  log: FastifyBaseLogger
) {
  const t0 = nowMs();
  const to = (
    order?.raw_payload?.customer_phone ||
    order?.raw_payload?.phone ||
    order?.raw_payload?.customer?.phone ||
    ''
  )
    .toString()
    .trim();
  if (!to) {
    log?.warn({ store_id: store.id, order_id: order.id }, 'order_missing_phone');
    throw new Error('order_missing_phone');
  }

  const locale = localeFromStore(store);
  const titleBase =
    locale === 'fr'
      ? `Bonjour 👋 c'est ${store.name}. Confirmez-vous la commande ${order.external_id} ?`
      : locale === 'ar' || locale === 'ary'
      ? `سلام! هادي ${store.name}. واش كتأكد الطلب ${order.external_id}؟`
      : `Hi! This is ${store.name}. Do you confirm order ${order.external_id}?`;

  const title = titleBase + languageHint(locale);

  const choices = [
    {
      id: 'confirm',
      title:
        locale === 'fr'
          ? '✅ Confirmer'
          : locale === 'ar' || locale === 'ary'
          ? '✅ نأكد'
          : '✅ Confirm',
    },
    {
      id: 'cancel',
      title:
        locale === 'fr'
          ? '❌ Annuler'
          : locale === 'ar' || locale === 'ary'
          ? '❌ نلغي'
          : '❌ Cancel',
    },
    {
      id: 'more',
      title:
        locale === 'fr'
          ? '❓ Plus d’info'
          : locale === 'ar' || locale === 'ary'
          ? '❓ مزيد المعلومات'
          : '❓ More info',
    },
  ];

  const waOk = await hasWhatsAppForStore(trx, store.id);
  let delivery_ok = false;
  let last_id: string | undefined;

  log?.info(
    {
      store_id: store.id,
      order_id: order.id,
      conversation_id: convo.id,
      to: maskPhone(to),
      locale,
      wa_ok: waOk,
    },
    'conversation_outbound_send_start'
  );

  if (waOk) {
    const sent = await sendWhatsAppChoices(trx, store.id, to, title, choices);
    delivery_ok = !!sent.ok;
    last_id = sent.id;
    if (sent.ok) {
      log?.info(
        { store_id: store.id, order_id: order.id, conversation_id: convo.id, message_id: sent.id, dur_ms: msSince(t0) },
        'wa_interactive_sent_ok'
      );
    } else {
      log?.warn(
        { store_id: store.id, order_id: order.id, conversation_id: convo.id, err: sent.error, dur_ms: msSince(t0) },
        'wa_interactive_sent_failed'
      );
    }
  } else {
    log?.info(
      { store_id: store.id, order_id: order.id, conversation_id: convo.id, dur_ms: msSince(t0) },
      'wa_credentials_unavailable_noop'
    );
  }

  await trx('conversations')
    .where({ id: convo.id })
    .update({
      metadata: trx.raw(
        "COALESCE(metadata,'{}'::jsonb) || ?::jsonb",
        JSON.stringify({
          state: 'await_choice',
          last_wa_id: last_id,
          channel: delivery_ok ? 'whatsapp' : 'noop',
          to,
          delivery_ok,
        })
      ),
      updated_at: trx.fn.now(),
    });

  if (delivery_ok) {
    await bumpConversationMetric(trx, store.seller_id, store.id, log);
  }
}

/* --------------------------------- LLM plan -------------------------------- */

async function llmPlan(
  db: DB,
  store: any,
  convo: any,
  history: { role: 'user' | 'assistant'; content: string }[],
  log?: FastifyBaseLogger
): Promise<LLMPlan> {
  const t0 = nowMs();
  const llm = await getLLMClient();

  // Prefer per-conversation language if set
  const convLocale = (convo?.metadata?.preferred_locale as 'fr' | 'en' | 'ar' | 'ary' | undefined) || localeFromStore(store);
  const sys = systemPrompt(store.name, convLocale);
  const msgs: ChatMessage[] = [...sys, ...history];

  log?.debug(
    { conversation_id: convo.id, history_len: history.length, locale: convLocale },
    'llm_plan_request'
  );

  const res: any = await (llm as any).chat({
    messages: msgs,
    stream: false,
    options: { temperature: 0.2, max_tokens: 200 },
  });

  const raw = typeof res === 'string' ? res : res?.content ?? '';
  const text = String(raw || '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const payload = jsonMatch ? jsonMatch[0] : text;

  try {
    const plan = JSON.parse(payload);
    log?.info(
      { conversation_id: convo.id, action: plan?.action, dur_ms: msSince(t0) },
      'llm_plan_parsed'
    );
    return plan;
  } catch (e: any) {
    log?.warn(
      { conversation_id: convo.id, parse_error: e?.message, dur_ms: msSince(t0) },
      'llm_plan_parse_failed_fallback'
    );
    return {
      action: 'ASK_MORE_INFO',
      message: defaultPromptByLocale(convLocale),
      need: ['other'],
    };
  }
}

/** Clear outcome = confirmed AND (no address needed OR address already OK). */
function isClearOutcome(convoMeta: any, orderStatus: string, plan: LLMPlan): boolean {
  const confirmed =
    plan.action === 'CONFIRM' ||
    (convoMeta?.state === 'confirmed' &&
      (orderStatus === 'processing' || orderStatus === 'completed'));
  const addressNeeded = !!convoMeta?.address_needed;
  const addressOk = !!convoMeta?.address_ok;
  return confirmed && (!addressNeeded || addressOk);
}

/* -------------------------------- decisions -------------------------------- */

async function sendTextWhatsAppOrNoop(
  trx: DB,
  store_id: string,
  to: string,
  body: string,
  log?: FastifyBaseLogger
) {
  const t0 = nowMs();
  const waOk = await hasWhatsAppForStore(trx, store_id);
  if (waOk) {
    const sent = await sendWhatsAppText(trx, store_id, to, body);
    if (sent.ok) {
      log?.info({ store_id, to: maskPhone(to), message_id: sent.id, dur_ms: msSince(t0) }, 'wa_text_sent_ok');
      return true;
    }
    log?.warn({ store_id, to: maskPhone(to), err: sent.error, dur_ms: msSince(t0) }, 'wa_text_sent_failed');
    return false;
  }
  log?.info({ store_id, to: maskPhone(to) }, 'wa_credentials_unavailable_noop');
  return false;
}

async function handlePlan(
  trx: DB,
  store: any,
  order: any,
  convo: any,
  plan: LLMPlan,
  log?: FastifyBaseLogger
): Promise<'remove' | 'keep'> {
  const to = ((convo?.metadata?.to ||
    order?.raw_payload?.customer_phone ||
    '') as string).trim();
  if (!to) {
    log?.warn({ store_id: store.id, order_id: order.id, conversation_id: convo.id }, 'missing_destination_phone');
    throw new Error('missing_destination_phone');
  }

  const convLocale = (convo?.metadata?.preferred_locale as 'fr' | 'en' | 'ar' | 'ary' | undefined) || localeFromStore(store);

  log?.info(
    { store_id: store.id, order_id: order.id, conversation_id: convo.id, action: plan.action, locale: convLocale },
    'conversation_decision_start'
  );

  if (plan.action === 'CONFIRM') {
    await trx('orders')
      .where({ id: order.id })
      .update({
        status: plan.status || 'processing',
        decision_by: 'ai',
        decision_result: {
          source: 'whatsapp',
          decision: 'confirm',
          status: 'confirmed',
        },
        updated_at: trx.fn.now(),
      });
    log?.info({ store_id: store.id, order_id: order.id }, 'order_status_updated_processing');

    await sendTextWhatsAppOrNoop(
      trx,
      store.id,
      to,
      plan.message || (convLocale ? defaultPromptByLocale(convLocale) : 'Thanks! Your order is confirmed ✅'),
      log
    );

    await trx('conversations')
      .where({ id: convo.id })
      .update({
        status: 'closed',
        metadata: trx.raw(
          "COALESCE(metadata,'{}'::jsonb) || ?::jsonb",
          JSON.stringify({ state: 'confirmed' })
        ),
        updated_at: trx.fn.now(),
      });

    await addMessage(trx, convo.id, 'assistant', plan.message || 'Order confirmed', {}, log);
    log?.info({ conversation_id: convo.id }, 'conversation_closed_confirmed');

    const freshConvo = await trx('conversations').where({ id: convo.id }).first();
    const freshOrder = await trx('orders').where({ id: order.id }).first();
    const clear = isClearOutcome(
      (freshConvo as any)?.metadata,
      (freshOrder as any)?.status,
      plan
    );
    log?.info({ conversation_id: convo.id, order_id: order.id, clear_outcome: clear }, 'conversation_outcome_evaluated');
    return clear ? 'remove' : 'keep';
  }

  if (plan.action === 'CANCEL') {
    await trx('orders')
      .where({ id: order.id })
      .update({
        status: 'cancelled',
        decision_by: 'ai',
        decision_result: {
          source: 'whatsapp',
          decision: 'cancel',
          status: 'cancelled',
        },
        updated_at: trx.fn.now(),
      });
    log?.info({ store_id: store.id, order_id: order.id }, 'order_status_updated_cancelled');

    await sendTextWhatsAppOrNoop(
      trx,
      store.id,
      to,
      plan.message || (convLocale === 'fr'
        ? 'Compris. Votre commande a été annulée.'
        : (convLocale === 'ar' || convLocale === 'ary')
          ? 'مفهوم. تم إلغاء طلبك.'
          : 'Understood. Your order has been cancelled.'
      ),
      log
    );

    await trx('conversations')
      .where({ id: convo.id })
      .update({
        status: 'closed',
        metadata: trx.raw(
          "COALESCE(metadata,'{}'::jsonb) || ?::jsonb",
          JSON.stringify({ state: 'cancelled' })
        ),
        updated_at: trx.fn.now(),
      });

    await addMessage(trx, convo.id, 'assistant', plan.message || 'Order cancelled', {}, log);
    log?.info({ conversation_id: convo.id }, 'conversation_closed_cancelled');

    // Keep cancelled jobs (only remove on confirmed + address OK)
    return 'keep';
  }

  if (plan.action === 'REQUEST_LOCATION') {
    await sendTextWhatsAppOrNoop(
      trx,
      store.id,
      to,
      plan.message || (
        (convLocale === 'fr')
          ? 'Merci de partager votre position pour mettre à jour votre adresse.'
          : (convLocale === 'ar' || convLocale === 'ary')
            ? 'عافاك شارك الموقع ديالك باش نحدّثو العنوان.'
            : 'Please share your live location to update your address.'
      ),
      log
    );

    await trx('conversations')
      .where({ id: convo.id })
      .update({
        metadata: trx.raw(
          "COALESCE(metadata,'{}'::jsonb) || ?::jsonb",
          JSON.stringify({ state: 'address_change', address_needed: true })
        ),
        updated_at: trx.fn.now(),
      });

    await addMessage(trx, convo.id, 'assistant', plan.message || 'Requesting location', {}, log);
    log?.info({ conversation_id: convo.id }, 'conversation_request_location');
    return 'keep';
  }

  // ASK_CHOICE / ASK_MORE_INFO / aimless chat → keep pushing for a decision
  await sendTextWhatsAppOrNoop(
    trx,
    store.id,
    to,
    plan.message || defaultPromptByLocale(convLocale),
    log
  );
  await addMessage(trx, convo.id, 'assistant', plan.message || 'Awaiting choice', {}, log);
  log?.info({ conversation_id: convo.id, action: plan.action }, 'conversation_prompt_choice');
  return 'keep';
}

/* ------------------------------- installation ------------------------------ */

export function installConversationWorker(db: DB, log?: FastifyBaseLogger) {
  const logger: FastifyBaseLogger =
    (log as any) || (console as unknown as FastifyBaseLogger);

  const handleJob = async (job: ConvoJob): Promise<ConvoHandlerResult> => {
    const t0 = nowMs();
    try {
      if (job.kind === 'scan') {
        logger.info({ label: job.label ?? 'scan' }, 'conversation_scan_start');
        const stores = await db('stores').where({ status: 'active' });
        logger.info({ stores: stores.length }, 'conversation_scan_active_stores');

        for (const store of stores) {
          const orders = await getUnprocessedOrders(db, store.id, 100);
          logger.info(
            { store_id: store.id, new_orders: orders.length },
            'conversation_scan_store'
          );
          for (const ord of orders) {
            await db.transaction(async (trx) => {
              // normalize missing status to 'new'
              if (!ord.status || String(ord.status).trim() === '') {
                await trx('orders')
                  .where({ id: ord.id })
                  .update({ status: 'new', updated_at: trx.fn.now() });
                logger.debug({ store_id: store.id, order_id: ord.id }, 'order_status_normalized_new');
              }
              const convo = await getOrCreateConversationForOrder(
                trx,
                store.id,
                ord.id,
                ord.customer_id || null
              );
              logger.debug(
                { store_id: store.id, order_id: ord.id, conversation_id: convo?.id },
                'conversation_found_or_created'
              );

              const hasAnyMsg = await trx('messages')
                .where({ conversation_id: convo.id })
                .first();
              if (!hasAnyMsg) {
                try {
                  await initialOutboundPing(trx, store, ord, convo, logger);
                  await addMessage(
                    trx,
                    convo.id,
                    'assistant',
                    '[system] sent choices',
                    {},
                    logger
                  );
                } catch (e: any) {
                  logger.warn(
                    {
                      store_id: store.id,
                      order_id: ord.id,
                      err: e?.message || String(e),
                    },
                    'conversation_initial_ping_failed'
                  );
                }
              } else {
                logger.debug(
                  { conversation_id: convo.id },
                  'conversation_already_has_messages_skip_initial'
                );
              }
            });
          }
        }
        logger.info({ dur_ms: msSince(t0) }, 'conversation_scan_done');
        return 'remove'; // remove scan jobs always
      }

      if (job.kind === 'init') {
        logger.info({ store_id: job.store_id, order_id: job.order_id }, 'conversation_init_job');
        const order = await db('orders')
          .where({ id: job.order_id, store_id: job.store_id })
          .first();
        if (!order) {
          logger.warn({ store_id: job.store_id, order_id: job.order_id }, 'conversation_init_order_missing');
          return 'keep';
        }
        const store = await getStore(db, job.store_id);
        if (!store) {
          logger.warn({ store_id: job.store_id }, 'conversation_init_store_missing');
          return 'keep';
        }

        await db.transaction(async (trx) => {
          if (!order.status || String(order.status).trim() === '') {
            await trx('orders')
              .where({ id: order.id })
              .update({ status: 'new', updated_at: trx.fn.now() });
            logger.debug({ store_id: store.id, order_id: order.id }, 'order_status_normalized_new');
          }
          const convo = await getOrCreateConversationForOrder(
            trx,
            store.id,
            order.id,
            order.customer_id || null
          );
          logger.debug({ conversation_id: convo.id }, 'conversation_found_or_created');

          try {
            await initialOutboundPing(trx, store, order, convo, logger);
            await addMessage(trx, convo.id, 'assistant', '[system] sent choices', {}, logger);
          } catch (e: any) {
            logger.warn(
              {
                store_id: store.id,
                order_id: order.id,
                err: e?.message || String(e),
              },
              'conversation_initial_ping_failed'
            );
          }
        });
        logger.info({ dur_ms: msSince(t0) }, 'conversation_init_done');
        return 'keep';
      }

      if (job.kind === 'incoming') {
        logger.info(
          { store_id: job.store_id, conversation_id: job.conversation_id, from: maskPhone(job.from), has_text: !!job.text },
          'conversation_incoming_start'
        );
        const store = await getStore(db, job.store_id);
        if (!store) {
          logger.warn({ store_id: job.store_id }, 'conversation_incoming_store_missing');
          return 'keep';
        }

        const convo = await db('conversations')
          .where({ id: job.conversation_id, store_id: job.store_id })
          .first();
        if (!convo) {
          logger.warn({ store_id: job.store_id, conversation_id: job.conversation_id }, 'conversation_missing_on_incoming');
          return 'keep';
        }

        // If incoming payload has a location, mark address_ok
        if ((job as any)?.payload?.location) {
          await db('conversations')
            .where({ id: job.conversation_id, store_id: job.store_id })
            .update({
              metadata: db.raw(
                "COALESCE(metadata,'{}'::jsonb) || ?::jsonb",
                JSON.stringify({ address_ok: true })
              ),
              updated_at: db.fn.now(),
            });
          logger.info({ conversation_id: job.conversation_id }, 'conversation_address_ok_marked');
        }

        // Persist incoming text + detect per-conversation preferred language
        const text = (job.text || '').trim();
        if (text) {
          const detected = detectPreferredLocaleFromText(text);
          if (detected && detected !== convo?.metadata?.preferred_locale) {
            await db('conversations')
              .where({ id: convo.id })
              .update({
                metadata: db.raw(
                  "COALESCE(metadata,'{}'::jsonb) || ?::jsonb",
                  JSON.stringify({ preferred_locale: detected })
                ),
                updated_at: db.fn.now(),
              });
            logger.info(
              { conversation_id: convo.id, preferred_locale: detected },
              'conversation_preferred_language_updated'
            );
            (convo as any).metadata = {
              ...(convo as any).metadata,
              preferred_locale: detected,
            };
          }

          await addMessage(db, convo.id, 'user', text, { origin: 'whatsapp', from: job.from }, logger);
        }

        // Clear-outcome fast path
        const orderId = (convo as any)?.metadata?.order_id as string | undefined;
        const order = orderId
          ? await db('orders')
              .where({ id: orderId, store_id: job.store_id })
              .first()
          : null;
        if (!order) {
          logger.warn({ store_id: job.store_id, conversation_id: job.conversation_id }, 'conversation_incoming_order_missing');
          return 'keep';
        }

        if (convo.status === 'closed') {
          const plan: LLMPlan = { action: 'CONFIRM', message: '' };
          if (isClearOutcome((convo as any).metadata, (order as any).status, plan)) {
            logger.info({ conversation_id: convo.id, order_id: order.id }, 'conversation_already_closed_clear_remove');
            return 'remove';
          }
        }

        // short history
        const rows = await db('messages')
          .select('role', 'content')
          .where({ conversation_id: convo.id })
          .orderBy('created_at', 'asc')
          .limit(20);
        const history = rows.map(
          (r: any) =>
            ({
              role: r.role,
              content: r.content,
            } as { role: 'user' | 'assistant'; content: string })
        );

        const plan = await llmPlan(db, store, convo, history, logger);
        const decision = await handlePlan(db, store, order, convo, plan, logger);
        logger.info(
          { conversation_id: convo.id, order_id: order.id, decision },
          'conversation_incoming_done'
        );
        return decision; // 'remove' only when confirmed + address OK (if needed)
      }

      if (job.kind === 'followup') {
        logger.info({ conversation_id: job.conversation_id }, 'conversation_followup_noop');
        return 'keep';
      }

      logger.warn({ job_kind: (job as any)?.kind }, 'conversation_unknown_job_kind');
      return 'keep';
    } catch (e: any) {
      logger.error({ err: e?.stack || e?.message || String(e) }, 'conversation_job_unhandled_error');
      return 'keep';
    } finally {
      logger.debug({ job_kind: (job as any)?.kind, dur_ms: msSince(t0) }, 'conversation_job_finished');
    }
  };

  if (RUN_WORKERS) {
    ensureInProcessConversationWorker(handleJob);
    const provider = getProviderName();
    const concurrency = Number(process.env.CONVO_CONCURRENCY || '6');
    logger.info(
      { name: 'conversation', provider, concurrency, RUN_WORKERS, wa_enabled: WHATSAPP_ENABLED, wa_env: isWhatsAppEnvConfigured() },
      'conversation_worker_installed'
    );
  }

  return { warm: () => void 0 };
}

export default { installConversationWorker };
