/**
 * CTRL — Branded Primitive Types
 * 
 * Provides compile-time type safety preventing accidental mixing of
 * monetary units (paise vs rupees), probabilities (0..1), and domain IDs.
 */

declare const BrandSymbol: unique symbol;

export type Branded<T, Brand extends string> = T & { readonly [BrandSymbol]: Brand };

/**
 * Monetary value strictly represented in integer paise (1 INR = 100 paise).
 */
export type Paise = Branded<number, 'Paise'>;

export function asPaise(value: number): Paise {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Expected finite number for Paise, received ${value}`);
  }
  return Math.round(value) as Paise;
}

/**
 * Tenant identifier enforcing multi-tenant isolation.
 */
export type TenantId = Branded<string, 'TenantId'>;

export function asTenantId(id: string): TenantId {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new TypeError(`Invalid TenantId: '${id}'`);
  }
  return id.trim() as TenantId;
}

/**
 * Unique Recovery Opportunity identifier.
 */
export type OpportunityId = Branded<string, 'OpportunityId'>;

export function asOpportunityId(id: string): OpportunityId {
  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    throw new TypeError(`Invalid OpportunityId: '${id}'`);
  }
  return id.trim() as OpportunityId;
}

/**
 * Probability value strictly in the range [0.0, 1.0].
 */
export type Probability = Branded<number, 'Probability'>;

export function asProbability(value: number): Probability {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`Probability must be between 0.0 and 1.0 inclusive, received ${value}`);
  }
  return value as Probability;
}

/**
 * Type guard for Probability.
 */
export function isProbability(value: unknown): value is Probability {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Result pattern for robust error handling without exceptions.
 */
export type Result<T, E = Error> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: E };

export function ok<T>(data: T): Result<T, never> {
  return { success: true, data };
}

export function err<E = Error>(error: E): Result<never, E> {
  return { success: false, error };
}
