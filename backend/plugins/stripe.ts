import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';

function enabled() {
  return (process.env.STRIPE_ENABLED ?? 'false').toLowerCase() === 'true';
}

export default fp(async function stripePlugin(app: FastifyInstance) {
  if (!enabled()) return;

  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    app.log.warn('STRIPE_ENABLED=true but STRIPE_SECRET_KEY missing. Skipping Stripe plugin.');
    return;
  }

  const stripe = new Stripe(secret, { apiVersion: '2024-06-20' as any });
  app.decorate('stripe', stripe);

  // Create/ensure a Stripe Customer for the current app user id
  async function getOrCreateCustomer(user: { id: string|number; email: string }) {
    // Look up your DB first; if you already store stripe_customer_id, use it.
    let rec = await (app as any).db('users').select('stripe_customer_id').where({ id: user.id }).first();
    if (rec?.stripe_customer_id) return rec.stripe_customer_id;

    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { app_user_id: String(user.id) },
    });
    await (app as any).db('users').where({ id: user.id }).update({ stripe_customer_id: customer.id });
    return customer.id;
  }

  // POST /billing/checkout → create a Checkout Session for a recurring price
  app.post('/checkout', async (req, reply) => {
    // You should authenticate the user; this is a simple example:
    const body = (req.body as any) || {};
    const price = body.price_id || process.env.STRIPE_PRICE_ID;
    const success_url = process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}';
    const cancel_url = process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/billing/cancel';

    if (!price) return reply.code(400).send({ ok: false, error: 'missing_price_id' });

    // Derive current app user from your auth (JWT / session). Example only:
    const userId = (req as any).user?.id || body.user_id; // replace with real auth
    const userEmail = (req as any).user?.email || body.email;
    if (!userId || !userEmail) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    const customerId = await getOrCreateCustomer({ id: userId, email: userEmail });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price, quantity: 1 }],
      success_url,
      cancel_url,
      allow_promotion_codes: true,
    });

    return reply.send({ ok: true, url: session.url, id: session.id });
  });

  // POST /billing/portal → create a Billing Portal session
  app.post('/portal', async (req, reply) => {
    const body = (req.body as any) || {};
    const return_url = body.return_url || 'http://localhost:3000/account/billing';

    const userId = (req as any).user?.id || body.user_id;
    const userEmail = (req as any).user?.email || body.email;
    if (!userId || !userEmail) return reply.code(401).send({ ok: false, error: 'unauthorized' });

    const customerId = await getOrCreateCustomer({ id: userId, email: userEmail });
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });
    return reply.send({ ok: true, url: portal.url });
  });

  // Webhook (optional): map Stripe events to app plans/tiers
  // Make sure your Fastify instance supports raw body for this route or add @fastify/raw-body.
  app.post('/webhook', async (req, reply) => {
    const sig = req.headers['stripe-signature'] as string | undefined;
    const whsec = process.env.STRIPE_WEBHOOK_SECRET;
    if (!sig || !whsec) return reply.code(400).send();

    let event: Stripe.Event;
    try {
      const buf: Buffer = (req.raw as any).rawBody || Buffer.from([]);
      event = stripe.webhooks.constructEvent(buf, sig, whsec);
    } catch (err) {
      req.log.error({ err }, 'stripe webhook signature verify failed');
      return reply.code(400).send();
    }

    // Handle subscription lifecycle to set your plan/tier
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          // Optional: you can look up session.customer and set user plan
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.created': {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;

          // Find user by stripe_customer_id
          const user = await (app as any).db('users').select('id').where({ stripe_customer_id: customerId }).first();
          if (user) {
            // Map price/product → your plan_code/tier as you see fit:
            // Example: mark pro on any active subscription
            const isActive = sub.status === 'active' || sub.status === 'trialing';
            await (app as any).db('users').where({ id: user.id }).update({
              tier: isActive ? 'pro' : 'starter',
            });
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const customerId = sub.customer as string;
          const user = await (app as any).db('users').select('id').where({ stripe_customer_id: customerId }).first();
          if (user) {
            await (app as any).db('users').where({ id: user.id }).update({ tier: 'starter' });
          }
          break;
        }
        default:
          // ignore others
          break;
      }
    } catch (err) {
      req.log.error({ err }, 'stripe webhook handler failed');
    }

    return reply.send({ received: true });
  });

  app.get('/config', async (_req, reply) => {
    // Expose minimal public config to frontend
    return reply.send({
      ok: true,
      stripeEnabled: true,
      priceId: process.env.STRIPE_PRICE_ID || null,
    });
  });

  app.log.info('Stripe plugin registered under /billing');
});
