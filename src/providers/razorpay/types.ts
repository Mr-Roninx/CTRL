export type ProviderType = 'razorpay' | 'stripe' | 'manual';
export type ProviderEnvironment = 'live' | 'test';
export type ProviderConnectionStatus = 'PENDING' | 'VERIFIED' | 'ACTIVE' | 'ERROR' | 'SUSPENDED';

export interface ProviderCapability {
  capability: string;
  supported: boolean;
  requires_live: boolean;
  status: 'VERIFIED' | 'UNSUPPORTED' | 'PROBING';
  details?: string;
}

export interface ProviderConnectionRecord {
  id: string;
  tenant_id: string;
  provider: ProviderType;
  environment: ProviderEnvironment;
  status: ProviderConnectionStatus;
  credential_reference: string;
  webhook_secret_reference?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
  capabilities?: ProviderCapability[];
}

export interface CreatePaymentLinkParams {
  amount_paise: number;
  currency: string;
  reference_id: string;
  description: string;
  customer: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, any>;
  notify?: {
    sms?: boolean;
    email?: boolean;
  };
}

export interface PaymentLinkResult {
  id: string;
  short_url: string;
  status: string;
  amount_paise: number;
  amount_paid_paise: number;
  created_at: string;
}
