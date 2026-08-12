import { Router, raw } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  PAYMENT_METHODS,
  PLANS,
  PLAN_IDS,
  methodsForRegion,
  type PaymentProvider,
  type PlanId,
} from '@lipsync/shared';
import { prisma, serialiseBigInts } from '../lib/prisma.js';
import { ApiError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { actorOf, requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { publishCredits } from '../realtime/socket.js';

export const billingRouter = Router();

/** Credits granted on each successful subscription period. */
const PLAN_CREDIT_GRANT: Record<PlanId, number> = {
  free: 300,
  pro: 20_000,
  studio: 100_000,
};

/* ------------------------------------------------------------------ */
/* Public catalogue                                                    */
/* ------------------------------------------------------------------ */

billingRouter.get(
  '/plans',
  validateQuery(z.object({ country: z.string().length(2).optional() })),
  (req, res) => {
    const country = (req.query as { country?: string }).country;
    res.json({
      plans: PLAN_IDS.map((id) => PLANS[id]),
      paymentMethods: country ? methodsForRegion(country) : Object.values(PAYMENT_METHODS),
    });
  },
);

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

const checkoutSchema = z.object({
  plan: z.enum(PLAN_IDS),
  interval: z.enum(['monthly', 'yearly']).default('monthly'),
  provider: z.enum(['stripe', 'paypal', 'airtel_money', 'mtn_momo']),
  /** Required for mobile money — the wallet that receives the approval prompt. */
  phoneNumber: z
    .string()
    .regex(/^\+?[1-9]\d{7,14}$/, 'Enter the number in international format, e.g. +265991234567.')
    .optional(),
});

/**
 * Card and wallet providers redirect the browser; mobile money instead pushes
 * an approval prompt to the payer's handset and settles asynchronously. Both
 * shapes come back from this one endpoint, discriminated by `mode`.
 */
billingRouter.post(
  '/checkout',
  requireAuth(),
  validateBody(checkoutSchema),
  async (req, res, next) => {
    try {
      const actor = actorOf(req);
      const body = req.body as z.infer<typeof checkoutSchema>;

      if (body.plan === 'free') {
        throw ApiError.badRequest('The Free plan does not need a checkout.');
      }

      const method = PAYMENT_METHODS[body.provider as PaymentProvider];
      if (method.requiresHandsetApproval && !body.phoneNumber) {
        throw ApiError.badRequest(`${method.name} needs the phone number to bill.`);
      }

      const plan = PLANS[body.plan];
      const amountUsd = body.interval === 'yearly' ? plan.yearlyUsd : plan.monthlyUsd;

      const payment = await prisma.payment.create({
        data: {
          userId: actor.userId,
          provider: body.provider,
          status: method.requiresHandsetApproval ? 'awaiting_approval' : 'pending',
          amountMinor: amountUsd * 100,
          currency: 'USD',
          description: `${plan.name} — ${body.interval}`,
          phoneNumber: body.phoneNumber ?? null,
          // One in-flight attempt per user, plan and interval, so a
          // double-clicked upgrade button cannot open two checkouts.
          idempotencyKey: `${actor.userId}:${body.plan}:${body.interval}:${Math.floor(
            Date.now() / 60_000,
          )}`,
        },
      });

      if (method.requiresHandsetApproval) {
        // The provider SDK call goes here; until credentials are configured we
        // record the intent and let the webhook drive settlement.
        logger.info(
          { paymentId: payment.id, provider: body.provider },
          'Mobile money collection requested',
        );
        res.status(202).json({
          mode: 'handset_approval',
          payment: serialiseBigInts(payment),
          message: `Approve the ${method.name} prompt on ${body.phoneNumber} to finish upgrading.`,
        });
        return;
      }

      const configured =
        body.provider === 'stripe' ? Boolean(env.STRIPE_SECRET_KEY) : Boolean(env.PAYPAL_CLIENT_ID);

      if (!configured) {
        throw ApiError.serviceUnavailable(
          `${method.name} payments are not configured on this deployment.`,
        );
      }

      res.json({
        mode: 'redirect',
        payment: serialiseBigInts(payment),
        checkoutUrl: `${env.WEB_URL}/billing/checkout/${payment.id}`,
      });
    } catch (error) {
      next(error);
    }
  },
);

billingRouter.get('/subscription', requireAuth(), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const [subscription, user] = await Promise.all([
      prisma.subscription.findUnique({ where: { userId: actor.userId } }),
      prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { plan: true, credits: true, periodSecondsUsed: true, periodResetAt: true },
      }),
    ]);

    const limits = PLANS[user.plan].limits;
    res.json({
      subscription: subscription ? serialiseBigInts(subscription) : null,
      plan: PLANS[user.plan],
      usage: {
        credits: user.credits,
        secondsUsed: user.periodSecondsUsed,
        secondsIncluded: limits.minutesPerMonth === null ? null : limits.minutesPerMonth * 60,
        resetsAt: user.periodResetAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.post('/subscription/cancel', requireAuth(), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const subscription = await prisma.subscription.findUnique({
      where: { userId: actor.userId },
    });
    if (!subscription) throw ApiError.notFound('You do not have an active subscription.');

    // Cancelling ends the plan at the period boundary, not immediately — the
    // user paid for the rest of the month and keeps it.
    const updated = await prisma.subscription.update({
      where: { userId: actor.userId },
      data: { cancelAtPeriodEnd: true },
    });

    res.json({
      subscription: serialiseBigInts(updated),
      message: `Your ${PLANS[subscription.plan].name} plan stays active until ${updated.currentPeriodEnd.toDateString()}.`,
    });
  } catch (error) {
    next(error);
  }
});

billingRouter.get('/payments', requireAuth(), async (req, res, next) => {
  try {
    const actor = actorOf(req);
    const payments = await prisma.payment.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ payments: serialiseBigInts(payments) });
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Provider webhooks                                                   */
/* ------------------------------------------------------------------ */

/**
 * Applies a settled payment: upgrades the plan, grants credits and opens a new
 * billing period. Written to be safe to call twice, because providers retry
 * webhooks and an at-least-once delivery must not grant credits twice.
 */
async function settlePayment(paymentId: string, providerRef: string): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) {
    logger.warn({ paymentId }, 'Webhook referenced an unknown payment');
    return;
  }
  if (payment.status === 'succeeded') return;

  const plan = (payment.description?.split(' — ')[0]?.toLowerCase() ?? 'pro') as PlanId;
  const resolvedPlan: PlanId = PLAN_IDS.includes(plan) ? plan : 'pro';
  const yearly = payment.description?.includes('yearly') ?? false;

  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + (yearly ? 12 : 1));

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'succeeded', providerRef, settledAt: new Date() },
    }),
    prisma.user.update({
      where: { id: payment.userId },
      data: {
        plan: resolvedPlan,
        credits: { increment: PLAN_CREDIT_GRANT[resolvedPlan] },
        periodSecondsUsed: 0,
        periodResetAt: periodEnd,
      },
    }),
    prisma.subscription.upsert({
      where: { userId: payment.userId },
      create: {
        userId: payment.userId,
        plan: resolvedPlan,
        provider: payment.provider,
        status: 'active',
        providerSubId: providerRef,
        currentPeriodEnd: periodEnd,
      },
      update: {
        plan: resolvedPlan,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date(),
        currentPeriodEnd: periodEnd,
        providerSubId: providerRef,
      },
    }),
  ]);

  const user = await prisma.user.findUnique({
    where: { id: payment.userId },
    select: { credits: true },
  });
  if (user) publishCredits(payment.userId, user.credits);

  logger.info({ paymentId, plan: resolvedPlan }, 'Payment settled and plan applied');
}

/** Constant-time signature comparison — a fast reject leaks the correct prefix. */
function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Stripe signs the *raw* body, so this route must see bytes rather than the
 * parsed JSON the rest of the API gets. `express.raw` is mounted here only.
 */
billingRouter.post(
  '/webhooks/stripe',
  raw({ type: 'application/json' }),
  async (req, res, next) => {
    try {
      const signature = req.header('stripe-signature');
      const secret = env.STRIPE_WEBHOOK_SECRET;

      if (!secret) {
        throw ApiError.serviceUnavailable('Stripe webhooks are not configured.');
      }
      if (!signature) throw ApiError.badRequest('Missing signature header.');

      // Stripe's header is `t=<ts>,v1=<sig>`; the signed payload is `<ts>.<body>`.
      const parts = Object.fromEntries(
        signature.split(',').map((part) => part.split('=') as [string, string]),
      );
      const timestamp = parts.t;
      const received = parts.v1;
      if (!timestamp || !received) throw ApiError.badRequest('Malformed signature header.');

      // Reject replays of an old, legitimately signed event.
      if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
        throw ApiError.badRequest('That webhook is too old to accept.');
      }

      const body = req.body as Buffer;
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${body.toString('utf8')}`)
        .digest('hex');

      if (!signatureMatches(expected, received)) {
        throw ApiError.unauthorized('Webhook signature did not verify.');
      }

      const event = JSON.parse(body.toString('utf8')) as {
        type: string;
        data: { object: { id: string; metadata?: { paymentId?: string } } };
      };

      if (event.type === 'checkout.session.completed' || event.type === 'invoice.paid') {
        const paymentId = event.data.object.metadata?.paymentId;
        if (paymentId) await settlePayment(paymentId, event.data.object.id);
      }

      res.json({ received: true });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Mobile money callback. Airtel and MTN post a similar shape; both authenticate
 * with a shared secret in a header rather than a body signature.
 */
billingRouter.post(
  '/webhooks/:provider(airtel_money|mtn_momo)',
  validateBody(
    z.object({
      reference: z.string().min(1),
      status: z.enum(['SUCCESS', 'SUCCESSFUL', 'FAILED', 'PENDING', 'TIMEOUT']),
      transactionId: z.string().min(1),
      reason: z.string().optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const provider = req.params.provider as 'airtel_money' | 'mtn_momo';
      const secret =
        provider === 'airtel_money' ? env.AIRTEL_SECRET : env.MTN_SUBSCRIPTION_KEY;
      const presented = req.header('x-callback-token');

      if (!secret) throw ApiError.serviceUnavailable(`${provider} is not configured.`);
      if (!presented || !signatureMatches(secret, presented)) {
        throw ApiError.unauthorized('Callback token did not verify.');
      }

      const { reference, status, transactionId, reason } = req.body;

      if (status === 'SUCCESS' || status === 'SUCCESSFUL') {
        await settlePayment(reference, transactionId);
      } else if (status === 'FAILED' || status === 'TIMEOUT') {
        await prisma.payment.updateMany({
          where: { id: reference, status: { in: ['pending', 'awaiting_approval'] } },
          data: {
            status: 'failed',
            providerRef: transactionId,
            failureReason: reason ?? `Payment ${status.toLowerCase()}.`,
          },
        });
      }

      res.json({ received: true });
    } catch (error) {
      next(error);
    }
  },
);

billingRouter.post('/webhooks/paypal', async (req, res, next) => {
  try {
    const event = req.body as {
      event_type?: string;
      resource?: { id?: string; custom_id?: string };
    };

    if (
      event.event_type === 'PAYMENT.CAPTURE.COMPLETED' &&
      event.resource?.custom_id &&
      event.resource.id
    ) {
      await settlePayment(event.resource.custom_id, event.resource.id);
    }

    res.json({ received: true });
  } catch (error) {
    next(error);
  }
});
