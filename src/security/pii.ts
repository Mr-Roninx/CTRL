/**
 * Enterprise PII (Personally Identifiable Information) Redaction & Masking
 * Implements DPDP / GDPR compliant field redaction for audit logs, API responses, and diagnostics.
 */

export class PIIMasker {
  /**
   * Masks a phone number (e.g. "+919876543210" -> "+91 98****3210")
   */
  public static maskPhone(phone?: string | null): string {
    if (!phone) return '—';
    const clean = phone.replace(/[^\d+]/g, '');
    if (clean.length <= 4) return '****';
    
    if (clean.startsWith('+91') && clean.length === 13) {
      return `+91 ${clean.slice(3, 5)}****${clean.slice(9)}`;
    }
    
    if (clean.length === 10) {
      return `${clean.slice(0, 2)}****${clean.slice(6)}`;
    }

    return `${clean.slice(0, 3)}****${clean.slice(-2)}`;
  }

  /**
   * Masks an email address (e.g. "rohan.verma@example.com" -> "r****a@example.com")
   */
  public static maskEmail(email?: string | null): string {
    if (!email) return '—';
    const parts = email.split('@');
    if (parts.length !== 2) return '****@domain.com';

    const user = parts[0];
    const domain = parts[1];
    if (!user || !domain) return '****@domain.com';

    if (user.length <= 2) {
      return `${user[0] ?? ''}*@${domain}`;
    }

    return `${user[0] ?? ''}****${user[user.length - 1] ?? ''}@${domain}`;
  }

  /**
   * Masks a customer name (e.g. "Rohan Verma" -> "Rohan V.")
   */
  public static maskName(name?: string | null): string {
    if (!name) return 'Customer';
    const tokens = name.trim().split(/\s+/);
    const first = tokens[0] ?? '';
    const second = tokens[1];
    if (!second) return first || 'Customer';
    return `${first} ${second[0] ?? ''}.`;
  }

  /**
   * Recursively traverses an object and masks known PII keys unless allowPII is true
   */
  public static sanitizeObject<T extends Record<string, any>>(obj: T, allowPII: boolean = false): T {
    if (allowPII || !obj || typeof obj !== 'object') return obj;

    const copy: any = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      if (typeof value === 'string') {
        if (lowerKey.includes('phone') || lowerKey.includes('contact')) {
          copy[key] = this.maskPhone(value);
        } else if (lowerKey.includes('email')) {
          copy[key] = this.maskEmail(value);
        } else if (lowerKey === 'customer_name' || lowerKey === 'name') {
          copy[key] = this.maskName(value);
        } else {
          copy[key] = value;
        }
      } else if (typeof value === 'object' && value !== null) {
        copy[key] = this.sanitizeObject(value, allowPII);
      } else {
        copy[key] = value;
      }
    }

    return copy as T;
  }
}
