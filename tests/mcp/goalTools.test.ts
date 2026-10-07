import type { CallToolResult } from '@modelcontextprotocol/server';

const mockUpsert = jest.fn();

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    profile: { upsert: mockUpsert },
    loggedSet: { findMany: jest.fn().mockResolvedValue([]) },
    meal: { findMany: jest.fn().mockResolvedValue([]) },
  })),
}));

// eslint-disable-next-line import/first
import { registerTallyTools } from '../../src/mcp/tools';

type Handler = (args: unknown, ctx: unknown) => Promise<CallToolResult>;
type ToolDef = { inputSchema: { safeParse: (v: unknown) => { success: boolean } } };

// Captures what registerTallyTools registers, so handlers can be called directly.
const tools: Record<string, { def: ToolDef; handler: Handler }> = {};
registerTallyTools({
  registerTool: (name: string, def: ToolDef, handler: Handler) => { tools[name] = { def, handler }; },
} as never);

const ctx = { http: { authInfo: { extra: { userId: 'user-1' } } } };

// A 29y/o, 178cm, 78.4kg man, moderately active, no Health Connect.
const baseProfile = {
  userId: 'user-1', sex: 'm', age: 29, heightCm: 178, weightKg: 78.4, activity: 2, connected: false,
  units: null, goal: 'Maintain', goalOffsetKcal: 0,
};

function body(result: CallToolResult): Record<string, unknown> {
  const first = result.content[0] as { text: string };
  return JSON.parse(first.text);
}

describe('update_goal tool', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saves a custom cut and reports the number applied', async () => {
    mockUpsert.mockImplementation(({ update }) => Promise.resolve({ ...baseProfile, ...update }));

    const result = await tools.update_goal.handler({ offsetKcal: -200 }, ctx);

    expect(result.isError).toBeFalsy();
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      update: { goalOffsetKcal: -200, goal: 'Cut (−450)' },
      create: { userId: 'user-1', goalOffsetKcal: -200, goal: 'Cut (−450)' },
    });
    const out = body(result);
    expect(out).toMatchObject({ ok: true, goal: 'Cut 200', goalOffsetKcal: -200 });
    expect(out.warning).toBeUndefined();
  });

  it.each([-1001, 701, 12.5])('schema rejects out-of-range/non-integer %p (nothing reaches the DB)', (bad) => {
    expect(tools.update_goal.def.inputSchema.safeParse({ offsetKcal: bad }).success).toBe(false);
  });

  it.each([-1000, 0, 700])('schema accepts boundary %p', (ok) => {
    expect(tools.update_goal.def.inputSchema.safeParse({ offsetKcal: ok }).success).toBe(true);
  });

  it('allows a target below the minimum but returns a warning', async () => {
    // Small, sedentary woman: BMR 1183 → burn 1420; −1000 → ~420 kcal, far under 1200.
    const small = { ...baseProfile, sex: 'f', age: 40, heightCm: 155, weightKg: 50, activity: 0 };
    mockUpsert.mockImplementation(({ update }) => Promise.resolve({ ...small, ...update }));

    const out = body(await tools.update_goal.handler({ offsetKcal: -1000 }, ctx));

    expect(mockUpsert).toHaveBeenCalled(); // still saved
    expect(out.ok).toBe(true);
    expect(out.estimatedTargetKcal).toBeLessThan(1200);
    expect(out.warning).toMatch(/below the 1200 kcal minimum/);
  });

  it('warns at 1 kcal under the minimum but not exactly at it', async () => {
    const sedentary = { ...baseProfile, activity: 0 };
    mockUpsert.mockImplementation(({ update }) => Promise.resolve({ ...sedentary, ...update }));
    const burn = body(await tools.update_goal.handler({ offsetKcal: 0 }, ctx)).estimatedTargetKcal as number;

    const atFloor = body(await tools.update_goal.handler({ offsetKcal: 1500 - burn }, ctx));
    expect(atFloor.estimatedTargetKcal).toBe(1500);
    expect(atFloor.warning).toBeUndefined();

    const underFloor = body(await tools.update_goal.handler({ offsetKcal: 1499 - burn }, ctx));
    expect(underFloor.estimatedTargetKcal).toBe(1499);
    expect(underFloor.warning).toMatch(/below the 1500 kcal minimum/);
  });

  it('turns a DB failure into a clean tool error, not a crash', async () => {
    mockUpsert.mockRejectedValue(new Error('connection refused at 10.0.0.1'));

    const result = await tools.update_goal.handler({ offsetKcal: -200 }, ctx);

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/10\.0\.0\.1/);
  });
});

describe('get_progress', () => {
  it('reports the goal offset and its label', async () => {
    mockUpsert.mockResolvedValue({ ...baseProfile, goalOffsetKcal: -200 });

    const out = body(await tools.get_progress.handler({}, ctx));

    expect(out.profile).toMatchObject({ goal: 'Cut 200', goalOffsetKcal: -200 });
  });
});
