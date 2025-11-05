import { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';
import { redis } from '../lib/redis';

// Email delivery
// We use nodemailer for sending transactional emails.  Configuration is
// driven via environment variables so that different SMTP providers
// can be used without changing code.  See `.env.example` for the
// expected variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
// SMTP_FROM).  If you do not configure these, the email worker will
// still run but will throw an error when attempting to deliver
// messages.  When adding additional providers, wrap them behind
// this transporter.
import nodemailer from 'nodemailer';
import { config as loadEnv } from 'dotenv';

loadEnv();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 587,
  secure: false,
  auth: process.env.SMTP_USER && process.env.SMTP_PASS
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

async function sendEmail(jobData: any): Promise<void> {
  const { to, subject, text, html } = jobData || {};
  if (!to || !subject || !(text || html)) {
    throw new Error('Invalid email job payload: missing to/subject/body');
  }
  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@example.com';
  await transporter.sendMail({
    from: fromAddr,
    to,
    subject,
    text: text || undefined,
    html: html || undefined,
  });
}

const defaultJobOpts: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: false
};

export const emailQueue = new Queue('email', { connection: redis, defaultJobOptions: defaultJobOpts });
export const emailEvents = new QueueEvents('email', { connection: redis });

export const emailWorker = new Worker(
  'email',
  async (job) => {
    try {
      await sendEmail(job.data);
      return true;
    } catch (err) {
      // Throwing here will trigger the 'failed' handler below.  You can
      // attach additional context to the error by rethrowing or logging
      // to a monitoring service.
      throw err;
    }
  },
  { connection: redis, concurrency: 5 }
);

emailWorker.on('failed', async (job, err) => {
  // Push to a simple dead‑letter list in Redis for later inspection or alerting.
  try {
    const payload = {
      jobId: job?.id,
      attemptsMade: job?.attemptsMade,
      failedReason: err?.message || String(err),
      data: job?.data,
      timestamp: Date.now(),
    };
    // We use LPUSH on a capped list so that it doesn't grow indefinitely.  Trim
    // to the most recent 100 failures.
    await redis.lPush('email:deadletter', JSON.stringify(payload));
    await redis.lTrim('email:deadletter', 0, 99);
  } catch (e: any) {
    console.error('Failed to record email failure', e);
  }
  console.error('email job failed', job?.id, err?.message);
});
