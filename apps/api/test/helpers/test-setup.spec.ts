import { createMockPrismaService } from '../mocks/prisma.mock';

describe('Test Framework Setup', () => {
  describe('Prisma Mock', () => {
    it('should create a mock Prisma service', () => {
      const mockPrisma = createMockPrismaService();
      expect(mockPrisma).toBeDefined();
      expect(mockPrisma.user).toBeDefined();
      expect(mockPrisma.role).toBeDefined();
    });
  });

  describe('Test Fixtures', () => {
    it('should have user fixtures available', () => {
      const { userFixtures } = require('../fixtures/users.fixture');
      expect(userFixtures).toBeDefined();
      expect(userFixtures.validUser).toBeDefined();
      expect(userFixtures.adminUser).toBeDefined();
    });

    it('should have role fixtures available', () => {
      const { roleFixtures, permissionFixtures } = require('../fixtures/roles.fixture');
      expect(roleFixtures).toBeDefined();
      expect(roleFixtures.admin).toBeDefined();
      expect(permissionFixtures).toBeDefined();
    });

    it('should have settings fixtures available', () => {
      const { userSettingsFixtures, systemSettingsFixtures } = require('../fixtures/settings.fixture');
      expect(userSettingsFixtures).toBeDefined();
      expect(systemSettingsFixtures).toBeDefined();
    });
  });
});
