import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config';

const mockUpsert = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    profile: { upsert: mockUpsert },
  })),
}));

// Imported after the mock above so the routes' `new PrismaClient()` picks up
// the mock implementation instead of the real client.
// eslint-disable-next-line import/first
import app from '../../src/index';

function makeToken(userId = 'user-1'): string {
  return jwt.sign({ userId, email: 'test@example.com', type: 'access' }, config.jwtSecret, {
    expiresIn: '15m',
  });
}

describe('Profile Routes', () => {
  const token = makeToken();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /profile', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/profile');
      expect(res.status).toBe(401);
    });

    it('returns the caller profile, creating a default one if missing', async () => {
      mockUpsert.mockResolvedValue({ userId: 'user-1', sex: 'm', age: 29 });

      const res = await request(app).get('/profile').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe('user-1');
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: {},
        create: { userId: 'user-1' },
      });
    });
  });

  describe('PUT /profile', () => {
    it('updates only the fields sent', async () => {
      mockUpsert.mockResolvedValue({ userId: 'user-1', weightKg: 80 });

      const res = await request(app)
        .put('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ weightKg: 80 });

      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { weightKg: 80 },
        create: { userId: 'user-1', weightKg: 80 },
      });
    });

    describe('goalOffsetKcal', () => {
      it.each([
        [-1000, 'Cut (−450)'],
        [-200, 'Cut (−450)'],
        [0, 'Maintain'],
        [300, 'Bulk (+300)'],
        [700, 'Bulk (+300)'],
      ])('accepts %i and mirrors it into the legacy goal column as %s', async (offset, legacy) => {
        mockUpsert.mockResolvedValue({ userId: 'user-1', goalOffsetKcal: offset });

        const res = await request(app)
          .put('/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ goalOffsetKcal: offset });

        expect(res.status).toBe(200);
        expect(mockUpsert).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
          update: { goalOffsetKcal: offset, goal: legacy },
          create: { userId: 'user-1', goalOffsetKcal: offset, goal: legacy },
        });
      });

      it.each([-1001, 701, 12.5, 'abc', null])('rejects %p with 400 and writes nothing', async (bad) => {
        const res = await request(app)
          .put('/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ goalOffsetKcal: bad });

        expect(res.status).toBe(400);
        expect(mockUpsert).not.toHaveBeenCalled();
      });

      it('leaves the goal alone when only other fields are sent', async () => {
        mockUpsert.mockResolvedValue({ userId: 'user-1' });

        await request(app).put('/profile').set('Authorization', `Bearer ${token}`).send({ age: 30 });

        const { update } = mockUpsert.mock.calls[0][0];
        expect(update).toEqual({ age: 30 });
      });

      it.each([
        ['Maintain', 0],
        ['Cut (−450)', -450],
        ['Bulk (+300)', 300],
      ])('converts a legacy goal %s from an old app build to %i', async (goal, offset) => {
        mockUpsert.mockResolvedValue({ userId: 'user-1' });

        const res = await request(app).put('/profile').set('Authorization', `Bearer ${token}`).send({ goal });

        expect(res.status).toBe(200);
        expect(mockUpsert.mock.calls[0][0].update).toEqual({ goalOffsetKcal: offset, goal });
      });

      it('prefers goalOffsetKcal over a legacy goal sent alongside it', async () => {
        mockUpsert.mockResolvedValue({ userId: 'user-1' });

        await request(app)
          .put('/profile')
          .set('Authorization', `Bearer ${token}`)
          .send({ goal: 'Cut (−450)', goalOffsetKcal: -200 });

        expect(mockUpsert.mock.calls[0][0].update).toEqual({ goalOffsetKcal: -200, goal: 'Cut (−450)' });
      });

      it('rejects an unknown legacy goal string', async () => {
        const res = await request(app).put('/profile').set('Authorization', `Bearer ${token}`).send({ goal: 'Cut 200' });
        expect(res.status).toBe(400);
      });
    });

    it('rejects an invalid field value', async () => {
      const res = await request(app)
        .put('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ sex: 'x' });

      expect(res.status).toBe(400);
    });
  });
});
