import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config';

const mockFindUnique = jest.fn();
const mockCreate = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  })),
}));

// Imported after the mock above so the routes' `new PrismaClient()` picks up
// the mock implementation instead of the real client.
// eslint-disable-next-line import/first
import app from '../../src/index';

describe('Auth Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/register', () => {
    it('registers a new user and seeds a default profile', async () => {
      mockFindUnique.mockResolvedValue(null);
      mockCreate.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'hashed',
      });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.user).toEqual({ id: 'user-1', email: 'test@example.com' });
      expect(res.body.tokens).toHaveProperty('accessToken');
      expect(res.body.tokens).toHaveProperty('refreshToken');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ profile: { create: {} } }),
        }),
      );
    });

    it('rejects a duplicate email', async () => {
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });

      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Email already registered');
    });

    it('rejects an invalid email', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });

    it('rejects a short password', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Validation failed');
    });
  });

  describe('POST /auth/login', () => {
    it('logs in with valid credentials', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com', passwordHash });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.user).toEqual({ id: 'user-1', email: 'test@example.com' });
      expect(res.body.tokens).toHaveProperty('accessToken');
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await bcrypt.hash('password123', 10);
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com', passwordHash });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'test@example.com', password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('rejects an unknown email', async () => {
      mockFindUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('issues new tokens for a valid refresh token', async () => {
      const refreshToken = jwt.sign(
        { userId: 'user-1', email: 'test@example.com', type: 'refresh' },
        config.jwtSecret,
        { expiresIn: '7d' },
      );
      mockFindUnique.mockResolvedValue({ id: 'user-1', email: 'test@example.com' });

      const res = await request(app).post('/auth/refresh').send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.tokens).toHaveProperty('accessToken');
      expect(res.body.tokens).toHaveProperty('refreshToken');
    });

    it('rejects an access token used as a refresh token', async () => {
      const accessToken = jwt.sign(
        { userId: 'user-1', email: 'test@example.com', type: 'access' },
        config.jwtSecret,
        { expiresIn: '15m' },
      );

      const res = await request(app).post('/auth/refresh').send({ refreshToken: accessToken });

      expect(res.status).toBe(401);
    });
  });
});
