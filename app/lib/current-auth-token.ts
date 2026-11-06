import { getToken } from "next-auth/jwt";
import { prisma } from "./prisma";
import { sessionIsCurrent } from "./account-security";

// For legacy API handlers that decode JWTs directly instead of getServerSession.
export async function getCurrentAuthToken(options: Parameters<typeof getToken>[0]) {
  const token = await getToken(options);
  if (!token || typeof token === "string" || typeof token.id !== "string") return null;
  const user = await prisma.user.findUnique({ where: { id: token.id }, select: {
    active: true, role: true, sessionVersion: true, emailVerificationRequired: true, emailVerifiedAt: true,
  } });
  if (!user || !sessionIsCurrent(token.sessionVersion, user)) return null;
  return { ...token, role: user.role };
}
