export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  cleanCnpj,
  CnpjValidationError,
  getCnpjNotFoundMessage,
  isValidCnpj,
  validateCnpjCompany,
} from "@/app/lib/cnpj";
import {
  DUPLICATE_WHATSAPP_MESSAGE,
  INVALID_WHATSAPP_MESSAGE,
  normalizeBrazilianWhatsapp,
} from "@/app/lib/whatsapp";
import { validatePublicSignupEmail } from "@/app/lib/email-validation";
import { normalizeEmail } from "@/app/lib/email-validation";
import { isValidCpf, normalizeCpf, passwordPolicyError, requiredSecret } from "@/app/lib/account-security";
import { limitAuthRequest } from "@/app/lib/auth-rate-limit";
import { authBody, authError } from "@/app/lib/auth-http";
import { issueAuthCode } from "@/app/lib/auth-service";

const CNPJ_DUPLICATE_MESSAGE = "Este CNPJ já possui uma conta cadastrada no Rotta.";
const INVALID_CNPJ_MESSAGE = "CNPJ inválido. Verifique os números informados.";

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
}

export async function POST(req: Request) {
  try {
    const body = await authBody(req);
    await limitAuthRequest(req.headers, "register", normalizeEmail(String(body.email ?? "")));
    requiredSecret("AUTH_CODE_SECRET");
    requiredSecret("DOCUMENT_HMAC_SECRET");

    const name = String(body?.name ?? "").trim();
    const emailInput = String(body?.email ?? "");
    const whatsappInput = String(body?.whatsapp ?? "");
    const password = String(body?.password ?? "");
    const cnpj = cleanCnpj(String(body?.cnpj ?? ""));
    const documentType = body.documentType === "CPF" ? "CPF" : body.documentType === "CNPJ" ? "CNPJ" : null;
    const cpf = normalizeCpf(String(body.cpf ?? ""));
    const whatsapp = normalizeBrazilianWhatsapp(whatsappInput);

    if (!name || name.length > 200 || !emailInput.trim() || !whatsappInput || !password || !documentType || !(documentType === "CPF" ? cpf : cnpj)) {
      return errorResponse("Preencha todos os campos obrigatórios.", 400);
    }

    if (!whatsapp) {
      return errorResponse(INVALID_WHATSAPP_MESSAGE, 400);
    }

    const emailValidation = await validatePublicSignupEmail(emailInput);
    if (!emailValidation.ok) {
      return errorResponse(emailValidation.message, 400);
    }

    const email = emailValidation.email;

    const policyError = passwordPolicyError(password);
    if (policyError) return errorResponse(policyError, 400);
    if (body.termsAccepted !== true || body.documentResponsibilityAccepted !== true) return errorResponse("Confirme os termos e sua autorização para usar o documento.", 400);

    if (documentType === "CPF" && !isValidCpf(cpf)) return errorResponse("CPF inválido. Verifique os números informados.", 400);
    if (documentType === "CNPJ" && !isValidCnpj(cnpj)) {
      return errorResponse(INVALID_CNPJ_MESSAGE, 400, "CNPJ_INVALID");
    }

    const [emailExists, cnpjExists, whatsappExists] = await Promise.all([
      prisma.user.findUnique({ where: { email } }),
      documentType === "CPF" ? prisma.user.findUnique({ where: { cpf }, select: { id: true } }) : prisma.company.findUnique({ where: { cnpj }, select: { id: true } }),
      prisma.user.findFirst({ where: { whatsapp }, select: { id: true } }),
    ]);

    if (emailExists) {
      if (emailExists.active && emailExists.emailVerificationRequired && !emailExists.emailVerifiedAt && await bcrypt.compare(password, emailExists.password)) {
        return NextResponse.json({ ok: true, requiresEmailVerification: true, message: "Sua conta já está criada. Retome a confirmação de e-mail e solicite um código se necessário." });
      }
      return errorResponse("Esse email já está cadastrado.", 409);
    }

    if (cnpjExists) {
      return errorResponse(documentType === "CPF" ? "Este CPF já possui uma conta cadastrada no Rotta." : CNPJ_DUPLICATE_MESSAGE, 409);
    }

    if (whatsappExists) {
      return errorResponse(DUPLICATE_WHATSAPP_MESSAGE, 409);
    }

    const companyDecision = documentType === "CNPJ" ? await validateCnpjCompany(cnpj) : null;

    if (companyDecision?.kind === "NOT_FOUND") {
      return errorResponse(getCnpjNotFoundMessage(), 400, "CNPJ_NOT_FOUND");
    }

    if (companyDecision?.kind === "INACTIVE") {
      return errorResponse("Este CNPJ não está ativo na Receita Federal.", 400, "CNPJ_INACTIVE");
    }

    if (companyDecision?.kind === "PENDING_VERIFICATION") {
      return NextResponse.json(
        {
          error: "Não foi possível concluir agora. Tente novamente mais tarde.",
          code: companyDecision.reason === "RATE_LIMIT" ? "CNPJ_RATE_LIMIT" : "CNPJ_UNAVAILABLE",
        },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } }
      );
    }

    // Only a positive registry result may reach the account/company transaction.
    const companyData = companyDecision?.kind === "VERIFIED" ? companyDecision.company : null;
    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const company = companyData ? await tx.company.create({
        data: {
          cnpj: companyData.cnpj,
          razaoSocial: companyData.razaoSocial,
          nomeFantasia: companyData.nomeFantasia,
          situacaoCadastral: companyData.situacaoCadastral,
          cidade: companyData.cidade,
          uf: companyData.uf,
          provider: companyData.provider,
          cnpjVerificationStatus: companyData.cnpjVerificationStatus,
          cnpjVerificationReason: companyData.cnpjVerificationReason,
          cnpjVerifiedAt: companyData.cnpjVerifiedAt,
          rawData: companyData.rawData as Prisma.InputJsonValue,
        },
        select: { id: true },
      }) : null;

      const createdUser = await tx.user.create({
        data: {
          name,
          email,
          whatsapp,
          password: hash,
          role: "USER",
          active: true,
          companyId: company?.id,
          documentType,
          cpf: documentType === "CPF" ? cpf : null,
          emailVerificationRequired: true,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          active: true,
          createdAt: true,
        },
      });

      return createdUser;
    });

    let emailSent = false;
    try { emailSent = (await issueAuthCode(user.id, "VERIFY_EMAIL")).ok; } catch { /* Keep account pending; resend can recover. */ }

    return NextResponse.json(
      {
        ok: true,
        requiresEmailVerification: true,
        emailSent,
        message: emailSent ? "Conta criada. Confirme seu e-mail com o código enviado." : "Conta criada e pendente de confirmação. O envio está indisponível no momento. Você pode solicitar outro código mais tarde.",
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof CnpjValidationError) {
      return errorResponse(error.message, 400, "CNPJ_INVALID");
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
      if (target.includes("cnpj")) return errorResponse(CNPJ_DUPLICATE_MESSAGE, 409);
      if (target.includes("cpf")) return errorResponse("Este CPF já possui uma conta cadastrada no Rotta.", 409);
      if (target.includes("email")) return errorResponse("Esse email já está cadastrado.", 409);
      if (target.includes("whatsapp")) return errorResponse(DUPLICATE_WHATSAPP_MESSAGE, 409);
    }

    return authError(error);
  }
}
