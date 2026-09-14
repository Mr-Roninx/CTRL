import Razorpay from 'razorpay';
import { SecretsManager } from '../../security/secrets.js';
import { ProviderEnvironment } from './types.js';

export interface RazorpayClientConfig {
  keyId: string;
  keySecret: string;
  environment: ProviderEnvironment;
}

export class RazorpayClientFactory {
  /**
   * Creates an official Razorpay SDK client from explicit config.
   * INVARIANT: Environment is never inferred from key prefix alone.
   */
  public static createClientFromConfig(config: RazorpayClientConfig): Razorpay {
    if (!config.keyId || !config.keySecret) {
      throw new Error('Razorpay initialization failed: keyId and keySecret are required.');
    }

    if (!config.environment || (config.environment !== 'live' && config.environment !== 'test')) {
      throw new Error(`Invalid environment: '${config.environment}'. Must be explicitly 'live' or 'test'.`);
    }

    return new Razorpay({
      key_id: config.keyId,
      key_secret: config.keySecret,
    });
  }

  /**
   * Creates a client dynamically for a specific tenant by decrypting their stored credentials.
   */
  public static async createClientForTenant(
    tenantId: string,
    credentialReference: string,
    environment: ProviderEnvironment
  ): Promise<Razorpay> {
    const rawSecretJson = await SecretsManager.getTenantCredential(tenantId, credentialReference);
    if (!rawSecretJson) {
      if (environment === 'test' && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
        return this.createClientFromConfig({
          keyId: process.env.RAZORPAY_KEY_ID,
          keySecret: process.env.RAZORPAY_KEY_SECRET,
          environment: 'test',
        });
      }
      throw new Error(`Tenant credential not found or decryption failed for reference: ${credentialReference}`);
    }

    let parsed: { key_id: string; key_secret: string };
    try {
      parsed = JSON.parse(rawSecretJson);
    } catch {
      throw new Error('Malformed tenant credential secret JSON payload.');
    }

    return this.createClientFromConfig({
      keyId: parsed.key_id,
      keySecret: parsed.key_secret,
      environment,
    });
  }
}
