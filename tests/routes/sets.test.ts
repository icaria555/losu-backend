import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config';

const mockFindMany = jest.fn();
const mockCreate = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    loggedSet: {
      findMany: mockFindMany,
      create: mockCreate,
    },
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

describe('Set Routes', () => {
  const token = makeToken();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /sets', () => {
    it('lists sets scoped to the caller, optionally filtered by exercise', async () => {
      mockFindMany.mockResolvedValue([{ id: 'set-1', exercise: 'Chest press', weightKg: 57.5, reps: 8 }]);

      const res = await request(app)
        .get('/sets?exercise=Chest+press')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.sets).toHaveLength(1);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', exercise: 'Chest press' },
        }),
      );
    });

    it('rejects a limit above 500', async () => {
      const res = await request(app)
        .get('/sets?limit=999')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /sets/last', () => {
    it('returns the most recent set per exercise', async () => {
      mockFindMany.mockResolvedValue([
        { exercise: 'Chest press', weightKg: 60, reps: 8, completedAt: new Date('2026-08-01') },
        { exercise: 'Lat pulldown', weightKg: 62.5, reps: 8, completedAt: new Date('2026-07-30') },
      ]);

      const res = await request(app).get('/sets/last').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.lastByExercise['Chest press'].weightKg).toBe(60);
      expect(res.body.lastByExercise['Lat pulldown'].weightKg).toBe(62.5);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          distinct: ['exercise'],
          orderBy: { completedAt: 'desc' },
        }),
      );
    });
  });

  describe('POST /sets', () => {
    it('logs a completed set for the caller', async () => {
      mockCreate.mockResolvedValue({ id: 'set-1', exercise: 'Chest press', weightKg: 60, reps: 8 });

      const res = await request(app)
        .post('/sets')
        .set('Authorization', `Bearer ${token}`)
        .send({ exercise: 'Chest press', weightKg: 60, reps: 8 });

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-1', exercise: 'Chest press', weightKg: 60 }),
        }),
      );
    });

    it('rejects a missing exercise name', async () => {
      const res = await request(app)
        .post('/sets')
        .set('Authorization', `Bearer ${token}`)
        .send({ weightKg: 60, reps: 8 });

      expect(res.status).toBe(400);
    });
  });
});
