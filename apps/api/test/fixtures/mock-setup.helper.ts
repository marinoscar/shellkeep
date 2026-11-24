import { prismaMock, mockPrismaTransaction } from '../mocks/prisma.mock';
import {
  createMockUser,
  createMockUserWithRelations,
  createMockAuditEvent,
  createMockSystemSettings,
  mockRoles,
  mockPermissions,
  MOCK_DEFAULT_ORG_ID,
  CreateMockUserOptions,
} from './test-data.factory';

/**
 * Mock setup helpers to configure Prisma mock responses
 * Use these to set up test scenarios without database calls
 */

// ============================================================================
// Role and Permission Mocks
// ============================================================================

export function setupRoleMocks(): void {
  // Mock role.findUnique - use mockResolvedValue for each call
  (prismaMock.role.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      if (where.name) {
        return mockRoles[where.name as keyof typeof mockRoles] || null;
      }
      if (where.id) {
        const role = Object.values(mockRoles).find((r) => r.id === where.id);
        return role || null;
      }
      return null;
    },
  );

  // Mock role.findMany
  (prismaMock.role.findMany as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      // Handle filtering by name with 'in' operator
      if (where?.name?.in && Array.isArray(where.name.in)) {
        return Object.values(mockRoles).filter((r) =>
          where.name.in.includes(r.name),
        );
      }
      // Return all roles if no filter
      return Object.values(mockRoles);
    },
  );

  // Mock permission.findUnique
  (prismaMock.permission.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      if (where.name) {
        const permission = Object.values(mockPermissions).find(
          (p) => p.name === where.name,
        );
        return permission || null;
      }
      return null;
    },
  );

  // Mock permission.findMany
  (prismaMock.permission.findMany as jest.Mock).mockResolvedValue(
    Object.values(mockPermissions),
  );
}

// ============================================================================
// User Mocks
// ============================================================================

export interface SetupMockUserResponse {
  id: string;
  email: string;
  roles: string[];
}

// Registry of mock users - accumulates users across multiple setupMockUser calls
let mockUserRegistry: Map<string, any> = new Map();

/**
 * Clear the mock user registry
 * Call this in beforeEach() along with resetPrismaMock()
 */
export function clearMockUserRegistry(): void {
  mockUserRegistry = new Map();
}

/**
 * Setup the user mock implementations
 * This should be called once in beforeEach after clearing the registry
 */
export function setupUserMocks(): void {
  // Mock user.findUnique - searches the registry
  (prismaMock.user.findUnique as jest.Mock).mockImplementation(
    async ({ where, include }: any) => {
      // Search by id
      if (where.id && mockUserRegistry.has(where.id)) {
        return mockUserRegistry.get(where.id);
      }
      // Search by email
      for (const user of mockUserRegistry.values()) {
        if (where.email === user.email) {
          return user;
        }
      }
      return null;
    },
  );

  // Mock user.update - updates user in registry
  (prismaMock.user.update as jest.Mock).mockImplementation(
    async ({ where, data, include }: any) => {
      const user = mockUserRegistry.get(where.id);
      if (user) {
        // Merge the data updates into the existing user
        const updated = { ...user };
        // Only update fields that are defined in data
        if (data.displayName !== undefined) updated.displayName = data.displayName;
        if (data.isActive !== undefined) updated.isActive = data.isActive;
        if (data.profileImageUrl !== undefined) updated.profileImageUrl = data.profileImageUrl;
        if (data.providerDisplayName !== undefined) updated.providerDisplayName = data.providerDisplayName;
        if (data.providerProfileImageUrl !== undefined) updated.providerProfileImageUrl = data.providerProfileImageUrl;

        mockUserRegistry.set(where.id, updated);
        return updated;
      }
      // Search by email
      for (const [id, u] of mockUserRegistry.entries()) {
        if (where.email === u.email) {
          const updated = { ...u, ...data };
          mockUserRegistry.set(id, updated);
          return updated;
        }
      }
      throw new Error('User not found');
    },
  );
}

/**
 * Setup a mock user in the Prisma mock
 * Returns the user data that will be "found" by Prisma queries
 * Supports multiple users - each call adds to the registry
 */
export function setupMockUser(
  options: CreateMockUserOptions = {},
): SetupMockUserResponse {
  const user = createMockUserWithRelations(options);

  // Add user to registry
  mockUserRegistry.set(user.id, user);

  // The role names the access token carries: the system roles plus the org role.
  const roles = [
    ...(user.userRoles?.map((ur: any) => ur.role.name) || []),
    ...(user.memberships?.map((m: any) => m.role.name) || []),
  ];

  return {
    id: user.id,
    email: user.email,
    roles,
  };
}

// ============================================================================
// System Settings Mocks
// ============================================================================

export function setupMockSystemSettings(): void {
  const settings = createMockSystemSettings();

  (prismaMock.systemSettings.findUnique as jest.Mock).mockResolvedValue(
    settings,
  );
  (prismaMock.systemSettings.upsert as jest.Mock).mockImplementation(
    async ({ create, update }: any) => {
      return { ...settings, ...create, ...update };
    },
  );
  (prismaMock.systemSettings.update as jest.Mock).mockImplementation(
    async ({ data }: any) => {
      return { ...settings, ...data };
    },
  );
}

// ============================================================================
// Credential Store Mocks
// ============================================================================

/**
 * The platform credential store reaches the database through `forUser(prisma, id)`,
 * which `$extends` the client: the mock answers with itself, and an empty store.
 */
export function setupMockCredentialStore(): void {
  (prismaMock.$extends as jest.Mock).mockReturnValue(prismaMock);
  (prismaMock.userCredential.findMany as jest.Mock).mockResolvedValue([]);
  (prismaMock.userCredential.findUnique as jest.Mock).mockResolvedValue(null);
  (prismaMock.userCredential.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
}

// ============================================================================
// Audit Event Mocks
// ============================================================================

export function setupMockAuditEvents(): void {
  const auditEvents: any[] = [];

  (prismaMock.auditEvent.create as jest.Mock).mockImplementation(
    async ({ data }: any) => {
      const event = createMockAuditEvent(data);
      auditEvents.push(event);
      return event;
    },
  );

  (prismaMock.auditEvent.findFirst as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      if (!where) return auditEvents[0] || null;

      return (
        auditEvents.find((event) => {
          let matches = true;
          if (where.actorUserId)
            matches &&= event.actorUserId === where.actorUserId;
          if (where.action) matches &&= event.action === where.action;
          if (where.targetId) matches &&= event.targetId === where.targetId;
          return matches;
        }) || null
      );
    },
  );
}

// ============================================================================
// User Settings Mocks
// ============================================================================

// Registry for user settings
let mockUserSettingsRegistry: Map<string, any> = new Map();

/**
 * Setup user settings mocks that work with the user registry
 */
export function setupUserSettingsMocks(): void {
  mockUserSettingsRegistry = new Map();

  (prismaMock.userSettings.findUnique as jest.Mock).mockImplementation(
    async ({ where }: any) => {
      // Check custom settings first
      if (mockUserSettingsRegistry.has(where.userId)) {
        return mockUserSettingsRegistry.get(where.userId);
      }
      // Fall back to user's default settings from registry
      const user = mockUserRegistry.get(where.userId);
      if (user?.userSettings) {
        return user.userSettings;
      }
      // Create default settings
      return {
        id: `settings-${where.userId}`,
        userId: where.userId,
        value: { theme: 'system' },
        version: 1,
        updatedAt: new Date(),
      };
    },
  );

  (prismaMock.userSettings.update as jest.Mock).mockImplementation(
    async ({ where, data }: any) => {
      const existing = mockUserSettingsRegistry.get(where.userId) || {
        id: `settings-${where.userId}`,
        userId: where.userId,
        value: { theme: 'system' },
        version: 1,
        updatedAt: new Date(),
      };
      const updated = {
        ...existing,
        value: data.value ?? existing.value,
        version: data.version ?? existing.version,
        updatedAt: new Date(),
      };
      mockUserSettingsRegistry.set(where.userId, updated);
      return updated;
    },
  );

  (prismaMock.userSettings.upsert as jest.Mock).mockImplementation(
    async ({ where, create, update }: any) => {
      const existing = mockUserSettingsRegistry.get(where.userId);
      if (existing) {
        const updated = { ...existing, ...update };
        mockUserSettingsRegistry.set(where.userId, updated);
        return updated;
      }
      const created = {
        id: `settings-${where.userId}`,
        userId: where.userId,
        ...create,
        updatedAt: new Date(),
      };
      mockUserSettingsRegistry.set(where.userId, created);
      return created;
    },
  );
}

/**
 * Set custom settings for a specific user
 */
export function setupMockUserSettings(userId: string, settings: any): void {
  mockUserSettingsRegistry.set(userId, {
    id: `settings-${userId}`,
    userId,
    value: settings,
    version: 1,
    updatedAt: new Date(),
  });
}

// ============================================================================
// Complete Mock Setup
// ============================================================================

/**
 * Setup all base mocks needed for most tests
 * Call this in beforeEach() after resetPrismaMock()
 */
export function setupBaseMocks(): void {
  // Clear registries
  clearMockUserRegistry();

  // Setup base mocks
  setupRoleMocks();
  setupUserMocks();
  setupUserSettingsMocks();
  setupMockSystemSettings();
  setupMockAuditEvents();
  setupMockCredentialStore();

  // Mock transactions
  mockPrismaTransaction();

  // The default organization, as `organizations WHERE is_default` answers it
  // (the identity slice resolves a legacy token's organization through it).
  (prismaMock.organization.findFirst as jest.Mock).mockResolvedValue({ id: MOCK_DEFAULT_ORG_ID });

  // `accessibleWhere` asks for the ids shared with the caller; nothing is shared in a mocked database.
  (prismaMock.grant.groupBy as jest.Mock).mockResolvedValue([]);

  // Mock $connect and $disconnect
  (prismaMock.$connect as jest.Mock).mockResolvedValue(undefined);
  (prismaMock.$disconnect as jest.Mock).mockResolvedValue(undefined);
}
