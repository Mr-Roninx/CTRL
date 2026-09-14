import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { verifySupabaseToken } from './supabase.js';
import { ApiKeyService } from './api_keys.js';

import { randomUUID } from 'node:crypto';
import { CacheManager } from '../cache/redis.js';

const JWT_SECRET = process.env.JWT_SECRET || 'ctrl_secure_jwt_secret_key_2026';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const SESSION_EXPIRY = '7d'; // 7-day session expiry for uninterrupted testing

export enum UserRole {
  OWNER = 'Owner',
  ADMIN = 'admin',
  OPERATOR = 'operator',
  VIEWER = 'viewer'
}

export interface AuthUser {
  userId: string;
  role: UserRole | string;
  merchant_id?: string;
  tenantId?: string;
  jti?: string;
  tokenType?: 'access' | 'refresh' | 'session';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  jti: string;
  expiresInSeconds: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

/**
 * Revokes a JWT by its unique ID (jti).
 */
export async function revokeToken(jti: string, ttlSeconds: number = 7 * 24 * 3600): Promise<void> {
  const cache = CacheManager.getInstance();
  await cache.set(`revoked:jti:${jti}`, '1', ttlSeconds);
}

/**
 * Checks whether a given jti has been blacklisted / revoked.
 */
export async function isTokenRevoked(jti?: string): Promise<boolean> {
  if (!jti) return false;
  const cache = CacheManager.getInstance();
  const val = await cache.get<string>(`revoked:jti:${jti}`);
  return val === '1';
}

/**
 * Generates an access token (15m) + refresh token (7d) pair with unique jti.
 */
export function generateTokenPair(payload: AuthUser): TokenPair {
  const jti = randomUUID();
  const accessToken = jwt.sign(
    { ...payload, jti, tokenType: 'access' },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY as any }
  );
  const refreshToken = jwt.sign(
    { userId: payload.userId, role: payload.role, tenantId: payload.tenantId, jti, tokenType: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY as any }
  );

  return {
    accessToken,
    refreshToken,
    jti,
    expiresInSeconds: 15 * 60,
  };
}

/**
 * Generates a signed JWT session token with expiration.
 */
export function generateSessionToken(payload: AuthUser, expiresIn: string = SESSION_EXPIRY): string {
  const jti = payload.jti || randomUUID();
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: expiresIn as any });
}

/**
 * Middleware to strictly enforce Role-Based Access Control (RBAC).
 * Expects `authenticateJWT` to have run first.
 */
export function authorizeRole(allowedRoles: (UserRole | string)[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized: No user session found.' });
      return;
    }

    const userRole = String(req.user.role || '').toLowerCase();
    const normalizedAllowed = allowedRoles.map(r => String(r).toLowerCase());

    // Owners and Admins have top-level access to all standard routes
    if (userRole === 'owner' || userRole === 'admin' || normalizedAllowed.includes(userRole) || normalizedAllowed.includes('*')) {
      return next();
    }

    res.status(403).json({ 
      error: 'Forbidden: Insufficient role permissions.',
      required: allowedRoles,
      current: req.user.role
    });
  };
}

/**
 * Verifies a given JWT token string.
 */
export function verifySessionToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser;
}

/**
 * Dual-Engine Authentication Middleware (Supports local CTRL JWT & Supabase Auth tokens).
 */
export async function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  const isExplicitDevBypass = process.env.NODE_ENV !== 'production' && process.env.AUTH_REQUIRED === 'false';

  // Allow test / local development bypass ONLY if explicitly configured in non-production
  if (isExplicitDevBypass && !req.headers.authorization) {
    req.user = {
      userId: 'dev_operator',
      role: UserRole.ADMIN,
      merchant_id: 'merchant_default',
      tenantId: 'tenant_system_default',
    };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing or invalid Authorization Bearer token' });
    return;
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Malformed Authorization header' });
    return;
  }

  // 1. Try API Key Authentication (Machine-to-Machine)
  if (token.startsWith('ul_live_') || token.startsWith('ul_test_')) {
    const keyAuth = await ApiKeyService.authenticateKey(token);
    if (keyAuth.valid && keyAuth.tenantId) {
      req.user = {
        userId: `key_${keyAuth.tenantId.slice(0, 8)}`,
        role: UserRole.ADMIN, // API keys have admin rights by default
        tenantId: keyAuth.tenantId,
        merchant_id: keyAuth.tenantId,
      };
      return next();
    }
  }

  // 2. Try local session JWT token
  try {
    const user = verifySessionToken(token) as any;
    if (user?.jti && (await isTokenRevoked(user.jti))) {
      res.status(401).json({ error: 'Unauthorized: Token has been revoked.' });
      return;
    }
    req.user = {
      userId: user.userId || user.id || 'dev_operator',
      role: user.role || UserRole.ADMIN,
      tenantId: user.tenantId || user.merchant_id || 'tenant_system_default',
      merchant_id: user.merchant_id || user.tenantId || 'tenant_system_default',
      jti: user.jti,
    };
    return next();
  } catch (localErr: any) {
    // 2. Try Supabase Auth token
    try {
      const sbResult = await verifySupabaseToken(token);
      if (sbResult.valid && sbResult.user) {
        const tenantId = sbResult.user.tenantId || `tnt_${sbResult.user.id.slice(0, 8)}`;
        req.user = {
          userId: sbResult.user.id,
          role: sbResult.user.role || 'Owner',
          merchant_id: tenantId,
          tenantId: tenantId,
        };
        return next();
      }
    } catch (sbErr) {
      // ignore
    }

    res.status(401).json({ error: 'Unauthorized: Session token expired or invalid', details: localErr.message });
  }
}

