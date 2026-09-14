export type UserRole = 'Viewer' | 'Analyst' | 'Operator' | 'Admin' | 'Owner';

export interface RolePermissions {
  canReadData: boolean;
  canTriggerRuns: boolean;
  canReviewDrafts: boolean;
  canConfigureIntegrations: boolean;
  canManageApiKeys: boolean;
  canRotateOwnerCredentials: boolean;
  canModifySafetyCeilings: boolean;
  canMarkProviderRecovery: boolean; // INVARIANT: FALSE FOR ALL ROLES
}

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  Viewer: {
    canReadData: true,
    canTriggerRuns: false,
    canReviewDrafts: false,
    canConfigureIntegrations: false,
    canManageApiKeys: false,
    canRotateOwnerCredentials: false,
    canModifySafetyCeilings: false,
    canMarkProviderRecovery: false,
  },
  Analyst: {
    canReadData: true,
    canTriggerRuns: false,
    canReviewDrafts: true,
    canConfigureIntegrations: false, // Invariant: Analyst cannot configure provider connections
    canManageApiKeys: false,
    canRotateOwnerCredentials: false,
    canModifySafetyCeilings: false,
    canMarkProviderRecovery: false,
  },
  Operator: {
    canReadData: true,
    canTriggerRuns: true,
    canReviewDrafts: true,
    canConfigureIntegrations: false,
    canManageApiKeys: true,
    canRotateOwnerCredentials: false, // Invariant: Operator cannot rotate owner credentials
    canModifySafetyCeilings: false,
    canMarkProviderRecovery: false,
  },
  Admin: {
    canReadData: true,
    canTriggerRuns: true,
    canReviewDrafts: true,
    canConfigureIntegrations: true,
    canManageApiKeys: true,
    canRotateOwnerCredentials: true,
    canModifySafetyCeilings: false, // Invariant: Admin cannot bypass platform safety ceilings
    canMarkProviderRecovery: false,
  },
  Owner: {
    canReadData: true,
    canTriggerRuns: true,
    canReviewDrafts: true,
    canConfigureIntegrations: true,
    canManageApiKeys: true,
    canRotateOwnerCredentials: true,
    canModifySafetyCeilings: true,
    canMarkProviderRecovery: false, // Invariant: Owner cannot manually mark a provider recovery
  },
};

export class RbacService {
  /**
   * Evaluates if a role possesses a specific permission.
   */
  public static hasPermission(role: UserRole, permission: keyof RolePermissions): boolean {
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) return false;
    return perms[permission] === true;
  }

  /**
   * Asserts that a role can perform a specific operation, throwing otherwise.
   */
  public static assertPermission(role: UserRole, permission: keyof RolePermissions, context: string): void {
    if (!this.hasPermission(role, permission)) {
      throw new Error(`Forbidden: Role '${role}' lacks permission '${permission}' for ${context}.`);
    }
  }
}
