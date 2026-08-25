import request from 'supertest';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config';

const mockFindMany = jest.fn();
const mockCreate = jest.fn();
const mockFindFirst = jest.fn();
const mockDelete = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    meal: {
      findMany: mockFindMany,
      create: mockCreate,
      findFirst: mockFindFirst,
      delete: mockDelete,
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

describe('Meal Routes', () => {
  const token = makeToken();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /meals', () => {
    it('lists meals scoped to the caller', async () => {
      mockFindMany.mockResolvedValue([{ id: 'meal-1', name: 'Oats' }]);

      const res = await request(app).get('/meals').set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.meals).toHaveLength(1);
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }),
      );
    });

    it('rejects a malformed date filter', async () => {
      const res = await request(app)
        .get('/meals?date=not-a-date')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /meals', () => {
    it('logs a meal for the caller', async () => {
      mockCreate.mockResolvedValue({ id: 'meal-1', name: 'Chicken rice bowl', kcal: 640 });

      const res = await request(app)
        .post('/meals')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Chicken rice bowl', kcal: 640, carbsG: 74, proteinG: 48, fatG: 18 });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Chicken rice bowl');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', kcal: 640 }) }),
      );
    });
  });

  describe('DELETE /meals/:id', () => {
    it("404s when the meal doesn't belong to the caller", async () => {
      mockFindFirst.mockResolvedValue(null);

      const res = await request(app)
        .delete('/meals/meal-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it('deletes an owned meal', async () => {
      mockFindFirst.mockResolvedValue({ id: 'meal-1', userId: 'user-1' });
      mockDelete.mockResolvedValue({});

      const res = await request(app)
        .delete('/meals/meal-1')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(204);
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 'meal-1' } });
    });
  });
});
