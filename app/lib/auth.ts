import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/app/lib/prisma";
import bcrypt from "bcrypt";
import { sessionIsCurrent } from "./account-security";
import { consumeAuthLimit } from "./auth-rate-limit";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },

  providers: [
    Credentials({
      name: "Email e Senha",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },

      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        if (email.length > 254) return null;
        await consumeAuthLimit("login:global", "all", 300, 60_000);
        await consumeAuthLimit("login:email", email, 20, 15 * 60_000);
        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.active) return null;

        const ok = await bcrypt.compare(credentials.password, user.password);
        if (!ok) return null;
        if (user.emailVerificationRequired && !user.emailVerifiedAt) throw new Error("EMAIL_VERIFICATION_REQUIRED");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const accountUser = user as typeof user & { role?: string; sessionVersion?: number };
        token.id = accountUser.id;
        token.role = accountUser.role;
        token.sessionVersion = accountUser.sessionVersion;
      }
      const currentUser = typeof token.id === "string" ? await prisma.user.findUnique({
        where: { id: token.id },
        select: { active: true, emailVerificationRequired: true, emailVerifiedAt: true, sessionVersion: true, role: true },
      }) : null;
      token.valid = !!currentUser && sessionIsCurrent(token.sessionVersion, currentUser);
      if (currentUser && token.valid) token.role = currentUser.role;
      return token;
    },

    async session({ session, token }) {
      if (!token.valid) return { ...session, user: undefined };
      if (session.user) {
        Object.assign(session.user, { id: token.id, role: token.role, sessionVersion: token.sessionVersion ?? 0 });
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
};
