import bcrypt from 'bcrypt';

const COST_FACTOR = 12;
const MIN_PASSWORD_LENGTH = 8;

export class PasswordService {
  /**
   * Hashes a plaintext password with bcrypt.
   */
  public static async hashPassword(plain: string): Promise<string> {
    PasswordService.validateStrength(plain);
    return bcrypt.hash(plain, COST_FACTOR);
  }

  /**
   * Verifies a plaintext password against a bcrypt hash.
   */
  public static async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /**
   * Validates password strength. Throws if too weak.
   */
  public static validateStrength(password: string): void {
    if (!password || typeof password !== 'string') {
      throw new Error('Password must be a non-empty string.');
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
    }
    if (!/[A-Z]/.test(password)) {
      throw new Error('Password must contain at least one uppercase letter.');
    }
    if (!/[0-9]/.test(password)) {
      throw new Error('Password must contain at least one number.');
    }
  }
}
