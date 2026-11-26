import type { Config } from '../config.js';
import { FakeGateway, type PaymentGateway } from './gateway.js';
import { MoyasarGateway } from './moyasar.js';

/** The configured payment provider, or none (PAYMENT_DRIVER). */
export function createGateway(config: Config): PaymentGateway | undefined {
  if (config.PAYMENT_DRIVER === 'moyasar') {
    return new MoyasarGateway({
      secretKey: config.MOYASAR_SECRET_KEY!,
      publishableKey: config.MOYASAR_PUBLISHABLE_KEY!,
      apiUrl: config.MOYASAR_API_URL.replace(/\/+$/, ''),
    });
  }
  if (config.PAYMENT_DRIVER === 'fake') return new FakeGateway();
  return undefined;
}
