import { updateServerProfileSchema } from './update-server-profile.dto';

describe('updateServerProfileSchema', () => {
  it('adds no default to an omitted field (a rename must not reset the port, tags or colour)', () => {
    expect(updateServerProfileSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
    expect(updateServerProfileSchema.parse({})).toEqual({});
  });

  it('still validates the fields it is given', () => {
    expect(updateServerProfileSchema.parse({ port: 2222, color: 'info', tags: ['a'] })).toEqual({
      port: 2222,
      color: 'info',
      tags: ['a'],
    });
    expect(updateServerProfileSchema.safeParse({ port: 70000 }).success).toBe(false);
    expect(updateServerProfileSchema.safeParse({ color: 'pink' }).success).toBe(false);
  });
});
