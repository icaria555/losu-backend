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
      mockUpsert.mockResolvedValue({ userId: 'user-1', goal: 'Cut (−450)' });

      const res = await request(app)
        .put('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ goal: 'Cut (−450)' });

      expect(res.status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        update: { goal: 'Cut (−450)' },
        create: { userId: 'user-1', goal: 'Cut (−450)' },
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
