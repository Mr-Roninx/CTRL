import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hpvmsdrgvjcltviogreh.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_isBEEktHW-X0wmyRn80S1w_eBsMjmKf';

let supabaseClientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClientInstance) {
    supabaseClientInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: (url: any, init: any) => {
          return fetch(url, {
            ...init,
            signal: init?.signal || AbortSignal.timeout(15000),
          });
        },
      },
    });
  }
  return supabaseClientInstance;
}

export interface SupabaseAuthResult {
  valid: boolean;
  user?: {
    id: string;
    email?: string;
    role?: string;
    tenantId?: string;
    metadata?: Record<string, any>;
  };
  error?: string;
}

/**
 * Validates a Supabase Access Token against the Supabase Auth service.
 */
export async function verifySupabaseToken(token: string): Promise<SupabaseAuthResult> {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getUser(token);

    if (!error && data?.user) {
      const user = data.user;
      const metadata = user.user_metadata || {};

      return {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          role: metadata.role || 'Owner',
          tenantId: metadata.tenant_id || `tnt_${user.id.slice(0, 8)}`,
          metadata,
        },
      };
    }

    return { valid: false, error: error?.message || 'Invalid or unverified Supabase token' };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
