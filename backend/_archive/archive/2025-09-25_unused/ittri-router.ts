
import { FastifyInstance } from 'fastify';
import { env } from '../../../shared/src/env.js';
import { http } from '../../../shared/src/http.js';
import { ollamaChat, ensureModelPulled } from './ittriClient.js';
import { autoLocale, systemPreamble } from './lang.js';

function bearer(token?: string) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default async function routes(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true, model: env.ITTRI_MODEL }));

  // Unified chat endpoint: dynamic prompting + backend context
  app.post('/v1/chat', async (req, reply) => {
    const body = (req.body as any) || {};
    const { messages, storeId, customerLocale, tools } = body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({ ok: false, error: 'messages_required' });
    }

    const locale = autoLocale(customerLocale);
    let storeMeta: any = null;
    try {
      if (storeId) {
        storeMeta = await http(`${env.BACKEND_URL}/seller/store`, {
          headers: { ...bearer(env.BACKEND_TOKEN) },
          timeoutMs: 10000,
        }).catch(() => null);
      }
    } catch {}

    const sys = systemPreamble(locale, storeMeta?.store);
    const chatReq = {
      model: env.ITTRI_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: sys },
        ...messages,
      ],
      options: {
        temperature: 0.4,
        top_p: 0.9,
      },
      tools: Array.isArray(tools) ? tools : undefined,
    };

    await ensureModelPulled().catch(()=>{});

    const resp = await ollamaChat(chatReq);
    return reply.send({ ok: true, data: resp });
  });

  // Extraction endpoint (structured)
  app.post('/v1/extract', async (req, reply) => {
    const body = (req.body as any) || {};
    const { schema, text, localeHint } = body;
    if (!schema || !text) {
      return reply.code(400).send({ ok: false, error: 'schema_and_text_required' });
    }
    const sys = `You are ITTRI. Extract data from text as strict JSON matching the provided schema. Do not include extra keys. If missing, set null.`;
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content: `Locale: ${autoLocale(localeHint)}\nSchema:\n${JSON.stringify(schema)}\nText:\n${text}` }
    ];
    await ensureModelPulled().catch(()=>{});
    const resp = await ollamaChat({ model: env.ITTRI_MODEL, messages, stream: false, options: { temperature: 0 } });
    return reply.send({ ok: true, data: resp });
  });
}
