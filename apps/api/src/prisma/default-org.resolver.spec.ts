import { InternalServerErrorException } from '@nestjs/common';
import { DefaultOrgResolver } from './default-org.resolver';
import { PrismaService } from './prisma.service';

describe('DefaultOrgResolver', () => {
  let findFirst: jest.Mock;
  let resolver: DefaultOrgResolver;

  beforeEach(() => {
    findFirst = jest.fn();
    resolver = new DefaultOrgResolver({
      organization: { findFirst },
    } as unknown as PrismaService);
  });

  it('returns the id of the default organization', async () => {
    findFirst.mockResolvedValue({ id: 'org-1' });

    await expect(resolver.resolve()).resolves.toBe('org-1');
    expect(findFirst).toHaveBeenCalledWith({
      where: { isDefault: true },
      select: { id: true },
    });
  });

  it('reads the database once and caches the id', async () => {
    findFirst.mockResolvedValue({ id: 'org-1' });

    await resolver.resolve();
    await resolver.resolve();
    await resolver.resolve();

    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('shares one lookup between concurrent callers', async () => {
    findFirst.mockResolvedValue({ id: 'org-1' });

    const ids = await Promise.all([resolver.resolve(), resolver.resolve()]);

    expect(ids).toEqual(['org-1', 'org-1']);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('fails when there is no default organization and does not cache the failure', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(resolver.resolve()).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );

    findFirst.mockResolvedValueOnce({ id: 'org-2' });
    await expect(resolver.resolve()).resolves.toBe('org-2');
  });
});
