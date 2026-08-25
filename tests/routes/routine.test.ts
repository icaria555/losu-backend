import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config';

const mockUpsert = jest.fn();
const mockFindFirst = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    routine: { upsert: mockUpsert },
    loggedSet: { findFirst: mockFindFirst },
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

describe('Routine Routes', () => {
  const token = makeToken();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /routine', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await request(app).get('/routine');
      expect(res.status).toBe(401);
    });

    it('returns the routine with a computed lastDone from logged history', async () => {
      mockUpsert.mockResolvedValue({ userId: 'user-1', name: 'Push A', exercises: ['Chest press', 'Incline press'] });
      mockFindFirst.mockResolvedValue({ completedAt: new Date('2026-08-13T10:00:00Z') });

      const res = await request(app).get('/routine').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        name: 'Push A',
        exercises: ['Chest press', 'Incline press'],
        lastDone: '2026-08-13T10:00:00.000Z',
      });
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', exercise: { in: ['Chest press', 'Incline press'] } },
        }),
      );
    });

    it('returns lastDone: null when nothing has been logged yet', async () => {
      mockUpsert.mockResolvedValue({ userId: 'user-1', name: 'Push A', exercises: ['Chest press'] });
      mockFindFirst.mockResolvedValue(null);

      const res = await request(app).get('/routine').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.lastDone).toBeNull();
    });
  });

  describe('PUT /routine', () => {
    it('updates the routine name and exercise list', async () => {
      mockUpsert.mockResolvedValue({ userId: 'user-1', name: 'Pull Day', exercises: ['Lat pulldown'] });
      mockFindFirst.mockResolvedValue(null);

      const res = await request(app)
        .put('/routine')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Pull Day', exercises: ['Lat pulldown'] });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Pull Day');
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { name: 'Pull Day', exercises: ['Lat pulldown'] },
        create: { userId: 'user-1', name: 'Pull Day', exercises: ['Lat pulldown'] },
      });
    });

    it('rejects an empty exercise list', async () => {
      const res = await request(app)
        .put('/routine')
        .set('Authorization', `Bearer ${token}`)
        .send({ exercises: [] });

      expect(res.status).toBe(400);
    });
  });
});
