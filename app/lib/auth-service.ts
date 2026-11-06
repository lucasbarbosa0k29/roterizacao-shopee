import { Prisma, type AuthChallengePurpose } from "@prisma/client";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "./prisma";
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, RESEND_INTERVAL_MS, canUseAccount, documentFingerprint, equalDigest, generateCode, passwordPolicyError, secureDigest } from "./account-security";
import { AuthRequestError, consumeAuthLimit } from "./auth-rate-limit";
import { sendAuthEmail } from "./auth-mail";

export async function authTransaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code) && attempt < 3) continue;
      throw error;
    }
  }
}

export async function issueAuthCode(userId: string, purpose: AuthChallengePurpose) {
  const code = generateCode();
  const generation = randomUUID();
  const codeHash = secureDigest("AUTH_CODE_SECRET", userId, purpose, generation, code);
  const issued = await authTransaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.active || (purpose === "VERIFY_EMAIL" && (!user.emailVerificationRequired || user.emailVerifiedAt))) return null;
    const existing = await tx.authChallenge.findUnique({ where: { userId_purpose: { userId, purpose } } });
    const now = new Date();
    if (existing && now.getTime() - existing.requestedAt.getTime() < RESEND_INTERVAL_MS) {
      throw new AuthRequestError("Aguarde um minuto antes de solicitar outro código.", 429, 60);
    }
    const data = { generation, codeHash, requestedAt: now, expiresAt: new Date(now.getTime() + CODE_TTL_MS), attempts: 0, consumedAt: null, resetTokenHash: null, delivered: false };
    await tx.authChallenge.upsert({ where: { userId_purpose: { userId, purpose } }, create: { userId, purpose, ...data }, update: data });
    return { email: user.email };
  });
  if (!issued) return { ok: true as const };
  // Reserve a bounded global budget too: different addresses cannot drain sending indefinitely.
  await consumeAuthLimit("mail:day", "all", 95, 24 * 60 * 60_000);
  await consumeAuthLimit("mail:month-budget", "all", 2900, 31 * 24 * 60 * 60_000);
  const result = await sendAuthEmail(issued.email, code, purpose, generation);
  if (result.ok) {
    await prisma.authChallenge.updateMany({ where: { userId, purpose, generation, consumedAt: null }, data: { delivered: true } });
  }
  return result;
}

export async function grantSignupBenefit(tx: Prisma.TransactionClient, user: { id: string; documentType: "CPF" | "CNPJ" | null; cpf: string | null; companyId: string | null }) {
  if (!user.documentType) return false; // Legacy / administrative accounts are not retroactively awarded.
  const company = user.companyId ? await tx.company.findUnique({
    where: { id: user.companyId },
    select: { cnpj: true, cnpjVerificationStatus: true, situacaoCadastral: true },
  }) : null;
  const document = user.documentType === "CPF" ? user.cpf : company?.cnpj;
  if (!document) throw new Error("Documento ausente para concessão do benefício.");
  // Also covers accounts created before signup stopped accepting pending CNPJs.
  if (user.documentType === "CNPJ" && (company?.cnpjVerificationStatus !== "VERIFIED" || company.situacaoCadastral !== "ATIVA")) return false;
  const fingerprint = documentFingerprint(user.documentType, document);
  const quantity = user.documentType === "CPF" ? 1 : 2;
  const claimed = await tx.signupBenefit.createMany({ data: [{ documentFingerprint: fingerprint, documentType: user.documentType, quantity }], skipDuplicates: true });
  if (claimed.count === 0) return false;
  await tx.routeCredit.create({ data: { userId: user.id, delta: quantity, reason: "PROMOTIONAL", notes: "Benefício único de cadastro com e-mail confirmado" } });
  return true;
}

export async function verifyAuthCode(email: string, purpose: AuthChallengePurpose, code: string) {
  const resetToken = randomBytes(32).toString("hex");
  return authTransaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email } });
    if (!user || !user.active) return { ok: false as const };
    const challenge = await tx.authChallenge.findUnique({ where: { userId_purpose: { userId: user.id, purpose } } });
    const now = new Date();
    if (!challenge || !challenge.delivered || challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= MAX_CODE_ATTEMPTS) return { ok: false as const };
    // Increment in a committed transaction even for a wrong code.
    await tx.authChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    const digest = secureDigest("AUTH_CODE_SECRET", user.id, purpose, challenge.generation, code);
    if (!/^\d{6}$/.test(code) || !equalDigest(challenge.codeHash, digest)) return { ok: false as const };
    await tx.authChallenge.update({ where: { id: challenge.id }, data: { consumedAt: now, resetTokenHash: purpose === "RESET_PASSWORD" ? secureDigest("AUTH_CODE_SECRET", "reset-token", resetToken) : null } });
    if (purpose === "VERIFY_EMAIL") {
      if (user.emailVerificationRequired && !user.emailVerifiedAt) {
        await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now } });
        await grantSignupBenefit(tx, user);
      }
      return { ok: true as const };
    }
    return { ok: true as const, resetToken };
  });
}

export async function resetPassword(email: string, token: string, password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new AuthRequestError(policyError);
  const tokenHash = secureDigest("AUTH_CODE_SECRET", "reset-token", token);
  const passwordHash = await bcrypt.hash(password, 10);
  return authTransaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { email } });
    if (!user || !user.active) return false;
    const challenge = await tx.authChallenge.findUnique({ where: { userId_purpose: { userId: user.id, purpose: "RESET_PASSWORD" } } });
    if (!challenge?.resetTokenHash || !challenge.consumedAt || challenge.expiresAt <= new Date() || !equalDigest(challenge.resetTokenHash, tokenHash)) return false;
    if (await bcrypt.compare(password, user.password)) throw new AuthRequestError("A nova senha deve ser diferente da atual.");
    await tx.user.update({ where: { id: user.id }, data: { password: passwordHash, sessionVersion: { increment: 1 } } });
    await tx.authChallenge.update({ where: { id: challenge.id }, data: { resetTokenHash: null } });
    return true;
  });
}

export async function changePassword(userId: string, sessionVersion: number, currentPassword: string, password: string) {
  const policyError = passwordPolicyError(password);
  if (policyError) throw new AuthRequestError(policyError);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !canUseAccount(user) || user.sessionVersion !== sessionVersion) throw new AuthRequestError("Entre novamente para continuar.", 401);
  if (!await bcrypt.compare(currentPassword, user.password)) throw new AuthRequestError("A senha atual está incorreta.");
  if (await bcrypt.compare(password, user.password)) throw new AuthRequestError("A nova senha deve ser diferente da atual.");
  const hash = await bcrypt.hash(password, 10);
  await authTransaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: userId, password: user.password, sessionVersion }, data: { password: hash, sessionVersion: { increment: 1 } } });
    if (updated.count !== 1) throw new AuthRequestError("Sua sessão mudou. Entre novamente.", 401);
    await tx.authChallenge.updateMany({ where: { userId, purpose: "RESET_PASSWORD" }, data: { consumedAt: new Date(), resetTokenHash: null } });
  });
}
