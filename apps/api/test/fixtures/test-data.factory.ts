import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Test data factories for creating mock entities
 * These create in-memory objects without database calls
 *
 * NOTE: These factories return plain objects that match Prisma types.
 * They intentionally don't import Prisma types directly to avoid
 * strict type checking issues in tests.
 */

// ============================================================================
// Roles and Permissions
// ============================================================================

export const mockPermissions = {
  systemSettingsRead: {
    id: randomUUID(),
    name: 'system_settings:read',
    description: 'Read system settings',
  },
  systemSettingsWrite: {
    id: randomUUID(),
    name: 'system_settings:write',
    description: 'Modify system settings',
  },
  userSettingsRead: {
    id: randomUUID(),
    name: 'user_settings:read',
    description: 'Read user settings',
  },
  userSettingsWrite: {
    id: randomUUID(),
    name: 'user_settings:write',
    description: 'Modify user settings',
  },
  usersRead: {
    id: randomUUID(),
    name: 'users:read',
    description: 'Read user data',
  },
  usersWrite: {
    id: randomUUID(),
    name: 'users:write',
    description: 'Modify user data',
  },
  rbacManage: {
    id: randomUUID(),
    name: 'rbac:manage',
    description: 'Manage roles and permissions',
  },
  allowlistRead: {
    id: randomUUID(),
    name: 'allowlist:read',
    description: 'Read allowlist',
  },
  allowlistWrite: {
    id: randomUUID(),
    name: 'allowlist:write',
    description: 'Modify allowlist',
  },
  serversRead: { id: randomUUID(), name: 'servers:read', description: 'Read server profiles' },
  serversWrite: { id: randomUUID(), name: 'servers:write', description: 'Modify server profiles' },
  sessionsRead: { id: randomUUID(), name: 'sessions:read', description: 'Read terminal sessions' },
  sessionsWrite: { id: randomUUID(), name: 'sessions:write', description: 'Modify terminal sessions' },
};

export const mockRoles = {
  admin: {
    id: randomUUID(),
    name: 'admin',
    description: 'Full system access',
  },
  contributor: {
    id: randomUUID(),
    name: 'contributor',
    description: 'Standard user capabilities',
  },
  viewer: {
    id: randomUUID(),
    name: 'viewer',
    description: 'Read-only access',
  },
};

// ============================================================================
// User Factory
// ============================================================================

export interface CreateMockUserOptions {
  id?: string;
  email?: string;
  displayName?: string | null;
  providerDisplayName?: string | null;
  profileImageUrl?: string | null;
  providerProfileImageUrl?: string | null;
  isActive?: boolean;
  roleName?: 'admin' | 'contributor' | 'viewer';
  createdAt?: Date;
  updatedAt?: Date;
}

export function createMockUser(options: CreateMockUserOptions = {}): any {
  const timestamp = Date.now();
  const {
    id = randomUUID(),
    email = `test-${timestamp}@example.com`,
    displayName = null,
    providerDisplayName = 'Test User',
    profileImageUrl = null,
    providerProfileImageUrl = 'https://example.com/photo.jpg',
    isActive = true,
    createdAt = new Date(),
    updatedAt = new Date(),
  } = options;

  return {
    id,
    email,
    displayName,
    providerDisplayName,
    profileImageUrl,
    providerProfileImageUrl,
    isActive,
    createdAt,
    updatedAt,
  };
}

// ============================================================================
// User Identity Factory
// ============================================================================

export interface CreateMockUserIdentityOptions {
  id?: string;
  userId: string;
  provider?: string;
  providerSubject?: string;
  providerEmail?: string | null;
  createdAt?: Date;
}

export function createMockUserIdentity(
  options: CreateMockUserIdentityOptions,
): any {
  const timestamp = Date.now();
  const {
    id = randomUUID(),
    userId,
    provider = 'google',
    providerSubject = `google-${timestamp}`,
    providerEmail = `test-${timestamp}@example.com`,
    createdAt = new Date(),
  } = options;

  return {
    id,
    userId,
    provider,
    providerSubject,
    providerEmail,
    createdAt,
  };
}

// ============================================================================
// User Role Factory
// ============================================================================

export interface CreateMockUserRoleOptions {
  userId: string;
  roleId: string;
}

export function createMockUserRole(options: CreateMockUserRoleOptions): any {
  const { userId, roleId } = options;

  // UserRole has composite primary key [userId, roleId], no id field
  return {
    userId,
    roleId,
  };
}

// ============================================================================
// User Settings Factory
// ============================================================================

export interface CreateMockUserSettingsOptions {
  id?: string;
  userId: string;
  value?: any;
  version?: number;
  updatedAt?: Date;
}

export function createMockUserSettings(
  options: CreateMockUserSettingsOptions,
): any {
  const {
    id = randomUUID(),
    userId,
    value = {
      theme: 'system',
      profile: {
        displayName: null,
        useProviderImage: true,
        customImageUrl: null,
      },
      updatedAt: new Date().toISOString(),
      version: 1,
    },
    version = 1,
    updatedAt = new Date(),
  } = options;

  return {
    id,
    userId,
    value,
    version,
    updatedAt,
  };
}

// ============================================================================
// System Settings Factory
// ============================================================================

export interface CreateMockSystemSettingsOptions {
  id?: string;
  key?: string;
  value?: any;
  version?: number;
  updatedByUserId?: string | null;
  updatedAt?: Date;
}

export function createMockSystemSettings(
  options: CreateMockSystemSettingsOptions = {},
): any {
  const {
    id = randomUUID(),
    key = 'default',
    value = {
      ui: { allowUserThemeOverride: true },
      features: {},
    },
    version = 1,
    updatedByUserId = null,
    updatedAt = new Date(),
  } = options;

  return {
    id,
    key,
    value,
    version,
    updatedByUserId,
    updatedAt,
  };
}

// ============================================================================
// Allowed Email Factory
// ============================================================================

export interface CreateMockAllowedEmailOptions {
  id?: string;
  email: string;
  notes?: string | null;
  addedById?: string | null;
  claimedById?: string | null;
  claimedAt?: Date | null;
  addedAt?: Date;
}

export function createMockAllowedEmail(
  options: CreateMockAllowedEmailOptions,
): any {
  const {
    id = randomUUID(),
    email,
    notes = null,
    addedById = null,
    claimedById = null,
    claimedAt = null,
    addedAt = new Date(),
  } = options;

  return {
    id,
    email: email.toLowerCase(),
    notes,
    addedById,
    claimedById,
    claimedAt,
    addedAt,
  };
}

// ============================================================================
// Audit Event Factory
// ============================================================================

export interface CreateMockAuditEventOptions {
  id?: string;
  actorUserId?: string | null;
  action: string;
  targetId: string;
  targetType: string;
  meta?: any;
  createdAt?: Date;
}

export function createMockAuditEvent(options: CreateMockAuditEventOptions): any {
  const {
    id = randomUUID(),
    actorUserId = null,
    action,
    targetId,
    targetType,
    meta = {},
    createdAt = new Date(),
  } = options;

  return {
    id,
    actorUserId,
    action,
    targetId,
    targetType,
    meta,
    createdAt,
  };
}

// ============================================================================
// Role Permissions (the real seeded catalog)
// ============================================================================

interface PermissionCatalog {
  rolePermissions: Record<string, string[]>;
}

/**
 * What the seed grants each role, straight from `prisma/catalog/permissions.json`
 * (the committed snapshot of the registries). A hand-written mirror would drift
 * from the seed and make an RBAC test pass for the wrong reason.
 */
const CATALOG: PermissionCatalog = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'prisma', 'catalog', 'permissions.json'), 'utf8'),
);

/** The permissions the seed grants `roleName` (system `admin`, or an org role). */
export function catalogPermissionsOf(roleName: string): string[] {
  const permissions = CATALOG.rolePermissions[roleName];
  if (!permissions) throw new Error(`Role "${roleName}" is not in prisma/catalog/permissions.json`);
  return permissions;
}

// ============================================================================
// Complete User with Relations
// ============================================================================

export interface MockRoleRecord {
  id: string;
  name: string;
  description: string | null;
  scope: 'system' | 'org';
  rolePermissions: Array<{
    roleId: string;
    permissionId: string;
    permission: { id: string; name: string; description: string | null };
  }>;
}

export interface MockUserWithRelations {
  id: string;
  email: string;
  displayName: string | null;
  providerDisplayName: string | null;
  profileImageUrl: string | null;
  providerProfileImageUrl: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** SYSTEM roles only (`user_roles`): `admin`. */
  userRoles?: Array<{ userId: string; roleId: string; role: MockRoleRecord }>;
  /** The default organization's membership, whose ORG role carries the domain permissions. */
  memberships?: Array<{
    orgId: string;
    userId: string;
    status: 'active';
    lastActiveAt: Date | null;
    createdAt: Date;
    org: { id: string; isDefault: boolean };
    role: MockRoleRecord;
  }>;
  identities?: any[];
  userSettings?: any;
}

/**
 * The default organization every mocked membership belongs to. A UUID: `runInOrg` refuses any other
 * id, and the sharing-aware server profile and runbook services run every read inside it (#71).
 */
export const MOCK_DEFAULT_ORG_ID = '8f1d5e0a-1b2c-4d3e-9f4a-5b6c7d8e9f01';

function roleRecord(name: string, scope: 'system' | 'org'): MockRoleRecord {
  const id = randomUUID();
  return {
    id,
    name,
    description: null,
    scope,
    rolePermissions: catalogPermissionsOf(name).map((permissionName) => ({
      roleId: id,
      permissionId: `perm-${permissionName}`,
      permission: { id: `perm-${permissionName}`, name: permissionName, description: null },
    })),
  };
}

/**
 * A user as the platform's principal graph loads it (`PRINCIPAL_USER_INCLUDE`):
 * the shape production stores. `admin` is the one SYSTEM role (`user_roles`) and
 * comes with an `org_admin` membership (platform migration 0024 gave every
 * administrator one); `contributor` and `viewer` are ORG roles held ONLY on the
 * default-organization membership. Permissions come from the seeded catalog.
 */
export function createMockUserWithRelations(
  options: CreateMockUserOptions = {},
): MockUserWithRelations {
  const user = createMockUser(options);
  const roleName = options.roleName || 'viewer';

  const systemRoles =
    roleName === 'admin' ? [roleRecord('admin', 'system')] : [];
  const orgRole = roleRecord(roleName === 'admin' ? 'org_admin' : roleName, 'org');

  const identity = createMockUserIdentity({
    userId: user.id,
    providerEmail: user.email,
  });

  const settings = createMockUserSettings({
    userId: user.id,
  });

  return {
    ...user,
    userRoles: systemRoles.map((role) => ({ userId: user.id, roleId: role.id, role })),
    memberships: [
      {
        orgId: MOCK_DEFAULT_ORG_ID,
        userId: user.id,
        status: 'active' as const,
        lastActiveAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        org: { id: MOCK_DEFAULT_ORG_ID, isDefault: true },
        role: orgRole,
      },
    ],
    identities: [identity],
    userSettings: settings,
  };
}
