import { and, count, eq, gte } from "drizzle-orm";
import { db } from "./index";
import { userRequests, users } from "./schema";

const DAILY_REQUEST_LIMIT = 100; // Adjust this value as needed

export async function getUserRequestCountToday(
  userId: string,
): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await db
    .select({ count: count() })
    .from(userRequests)
    .where(
      and(eq(userRequests.userId, userId), gte(userRequests.createdAt, today)),
    );

  return result[0]?.count ?? 0;
}

export async function addUserRequest(userId: string): Promise<void> {
  await db.insert(userRequests).values({
    userId,
  });
}

export async function isUserAdmin(userId: string): Promise<boolean> {
  const user = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user[0]?.isAdmin ?? false;
}

export async function checkRateLimit(userId: string): Promise<{
  allowed: boolean;
  remaining: number;
  limit: number;
}> {
  const isAdmin = await isUserAdmin(userId);

  if (isAdmin) {
    return {
      allowed: true,
      remaining: -1, // Unlimited for admins
      limit: -1,
    };
  }

  const requestCount = await getUserRequestCountToday(userId);
  const remaining = Math.max(0, DAILY_REQUEST_LIMIT - requestCount);

  return {
    allowed: requestCount < DAILY_REQUEST_LIMIT,
    remaining,
    limit: DAILY_REQUEST_LIMIT,
  };
}
