// Minimal pluggable WhatsApp sender. Replace internals with your actual provider SDKs.
// We expose a single sendText API used by the worker.

export type WAConfig = {
  provider: 'meta' | 'twilio' | 'gupshup' | string;
  number?: string | null;
  credentials: Record<string, any>;
};

export type SendResult = { ok: boolean; id?: string; error?: string };

export class WhatsAppClient {
  constructor(private cfg: WAConfig) {}

  async sendText(to: string, body: string): Promise<SendResult> {
    try {
      switch (this.cfg.provider) {
        case 'meta':
          // TODO: call Meta WA Cloud API using this.cfg.credentials.access_token, this.cfg.credentials.phone_id, ...
          // await fetch('https://graph.facebook.com/v19.0/.../messages', { ... })
          break;
        case 'twilio':
          // TODO: call Twilio's API with accountSid/authToken
          break;
        case 'gupshup':
          // TODO: call Gupshup API
          break;
        default:
          // Custom/self-hosted gateway
          // await fetch(this.cfg.credentials.baseUrl + '/send', {...})
          break;
      }
      return { ok: true, id: `${Date.now()}` };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
}

