import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { connection, QUEUE_NAMES } from '../queues/index.js';
import { getDb } from '../db/index.js';
import { getWhatsappForStore } from './storeApiSelector.js';
import { WhatsAppClient } from './waClient.js';
import { findOrCreateConversation, saveTurn } from './dbConvo.js';
import { systemPrompt } from './prompt.js';
import { chatCompletion } from '../ai/ollamaClient.js'; // you already have this client

type StartPayload = {
  type: 'conversation.start';
  store_id: string;
  order_id?: string;
  customer_id?: string | null;
  to: string;              // buyer phone in E.164
  buyer_text?: string;     // optional first message (e.g., from sheets)
  locale?: string;         // 'ar-darija' | 'fr' | 'en' | ...
  context?: Record<string, any>; // product/order snapshot
};

type UserMessagePayload = {
  type: 'conversation.user_message';
  store_id: string;
  conversation_id?: string;
  customer_id?: string | null;
  to: string;
  text: string;            // buyer message
  locale?: string;
  context?: Record<string, any>;
};

type JobData = StartPayload | UserMessagePayload;

let worker: Worker<JobData> | null = null;

function pickModel() {
  return process.env.OLLAMA_MODEL || 'ittri';
}

// Build the dynamic context given DB and payload (you can expand with products/orders)
async function buildContext(db: any, store_id: string, context?: any) {
  const store = await db('stores').select('id','name').where({ id: store_id }).first();
  // You can fetch top products, order summary, etc. Keep it small & relevant per turn.
  const products = await db('products')
    .select('sku','title','price','currency','inventory','status')
    .where({ store_id })
    .andWhere('status','active')
    .orderBy('created_at','desc')
    .limit(20)
    .catch(() => []);

  return { store, products, ...(context || {}) };
}

async function replyWithOllama({
  db, convoId, waClient, to, buyerText, storeName, languageHint, ctx
}: {
  db: any; convoId: string; waClient: WhatsAppClient; to: string;
  buyerText: string; storeName?: string; languageHint?: string; ctx: any;
}) {
  // Save user turn
  await saveTurn(db, convoId, 'user', buyerText, { to });

  // Compose chat for Ollama (system + few-shot dynamic context)
  const sys = systemPrompt({ storeName, languageHint });
  const contextBrief = [
    `Store: ${storeName ?? 'N/A'}`,
    ctx?.products?.length ? `Products: ${ctx.products.slice(0,5).map((p:any)=>`${p.title} (SKU ${p.sku}) ${p.price} ${p.currency}`).join(' | ')}` : 'Products: (none)'
  ].join('\n');

  const { text, tokens, timeMs } = await chatCompletion({
    model: pickModel(),
    messages: [
      { role: 'system', content: sys },
      { role: 'system', content: `Context:\n${contextBrief}` },
      { role: 'user', content: buyerText }
    ],
    // let your ollama client support streaming or not; here we assume single-shot
    temperature: 0.3,
    top_p: 0.9,
  });

  // Save assistant turn
  await saveTurn(db, convoId, 'assistant', text, { tokens, time_ms: timeMs });

  // Send to WhatsApp
  const sent = await waClient.sendText(to, text);
  if (!sent.ok) {
    // Save an agent/system warning
    await saveTurn(db, convoId, 'system', `WA send failed: ${sent.error}`, { provider: waClient['cfg']?.provider });
  }

  return { text, tokens, timeMs, wa: sent };
}

async function handleStart(job: Job<StartPayload>) {
  const db = getDb()!;
  const { store_id, customer_id = null, to, buyer_text, locale, context } = job.data;

  const wa = await getWhatsappForStore(db, store_id);
  if (!wa) throw new Error(`No WhatsApp channel configured for store ${store_id}`);

  const waClient = new WhatsAppClient({
    provider: wa.provider as any,
    number: wa.number ?? undefined,
    credentials: wa.credentials_json || {},
  });

  const conv = await findOrCreateConversation(db, store_id, customer_id, 'whatsapp');

  // If there's an initial buyer message, answer it; else send a greeting
  const ctx = await buildContext(db, store_id, context);
  const storeName = ctx?.store?.name as string | undefined;

  const firstMsg = buyer_text?.trim() ||
    (locale?.startsWith('ar') ? 'سلام! كيف نقدر نعاونك؟' :
     locale?.startsWith('fr') ? 'Bonjour ! Comment puis-je vous aider ?' :
     'Hi! How can I help you today?');

  return await replyWithOllama({
    db, convoId: conv.id, waClient, to,
    buyerText: firstMsg, storeName, languageHint: locale, ctx
  });
}

async function handleUserMessage(job: Job<UserMessagePayload>) {
  const db = getDb()!;
  const { store_id, conversation_id, customer_id = null, to, text, locale, context } = job.data;

  const wa = await getWhatsappForStore(db, store_id);
  if (!wa) throw new Error(`No WhatsApp channel configured for store ${store_id}`);

  const waClient = new WhatsAppClient({
    provider: wa.provider as any,
    number: wa.number ?? undefined,
    credentials: wa.credentials_json || {},
  });

  const conv = conversation_id
    ? await db('conversations').where({ id: conversation_id }).first()
    : await findOrCreateConversation(db, store_id, customer_id, 'whatsapp');

  if (!conv) throw new Error('Conversation not found or could not be created');

  const ctx = await buildContext(db, store_id, context);
  const storeName = ctx?.store?.name as string | undefined;

  return await replyWithOllama({
    db, convoId: conv.id, waClient, to,
    buyerText: text, storeName, languageHint: locale, ctx
  });
}

export function startConvoWorker() {
  if (worker) return worker;

  const concurrency = parseInt(process.env.CONVO_WORKER_CONCURRENCY || '8', 10);

  worker = new Worker<JobData>(
    QUEUE_NAMES.WORKFLOW_CONTROL, // reuse your shared "workflow-control" queue
    async (job) => {
      switch (job.data.type) {
        case 'conversation.start':        return handleStart(job as Job<StartPayload>);
        case 'conversation.user_message': return handleUserMessage(job as Job<UserMessagePayload>);
        default: throw new Error(`Unsupported job type: ${(job.data as any).type}`);
      }
    },
    { connection, concurrency }
  );

  worker.on('completed', (job, res) =>
    console.log(`[convoWorker] ✔ ${job.name}#${job.id}`, JSON.stringify(res ?? {}).slice(0, 200))
  );
  worker.on('failed', (job, err) =>
    console.error(`[convoWorker] ✖ ${job?.name}#${job?.id}`, err?.message || err)
  );

  console.log(`[convoWorker] started (queue: ${QUEUE_NAMES.WORKFLOW_CONTROL}, concurrency: ${concurrency})`);
  return worker;
}
