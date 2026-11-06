// app/lib/prisma.ts
import { PrismaClient } from "@prisma/client";
import { localDevelopmentEnabled } from "./local-development.js";

localDevelopmentEnabled(); // Reject a remote URL before constructing a local development client.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Raw Prisma errors may include document values or password hashes.
    log: [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
