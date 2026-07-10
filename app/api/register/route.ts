export const runtime = "nodejs";

import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  cleanCnpj,
  CnpjValidationError,
  isValidCnpj,
  validateCnpjCompany,
} from "@/app/lib/cnpj";
import {
  DUPLICATE_WHATSAPP_MESSAGE,
  INVALID_WHATSAPP_MESSAGE,
  normalizeBrazilianWhatsapp,
} from "@/app/lib/whatsapp";
import { validatePublicSignupEmail } from "@/app/lib/email-validation";

const CNPJ_DUPLICATE_MESSAGE = "Este CNPJ já possui uma conta cadastrada no Rotta.";
const INVALID_CNPJ_MESSAGE = "CNPJ inválido. Verifique os números informados.";
const PENDING_CNPJ_MESSAGE =
  "Cadastro criado. Não conseguimos confirmar seu CNPJ agora, possivelmente por ser MEI recente. Ele ficará pendente de verificação.";

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const name = String(body?.name ?? "").trim();
    const emailInput = String(body?.email ?? "");
    const whatsappInput = String(body?.whatsapp ?? "");
    const password = String(body?.password ?? "");
    const cnpj = cleanCnpj(String(body?.cnpj ?? ""));
    const whatsapp = normalizeBrazilianWhatsapp(whatsappInput);

    if (!name || !emailInput.trim() || !whatsappInput || !password || !cnpj) {
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

    if (password.length < 6) {
      return errorResponse("Senha precisa ter no mínimo 6 caracteres.", 400);
    }

    if (!isValidCnpj(cnpj)) {
      return errorResponse(INVALID_CNPJ_MESSAGE, 400);
    }

    const [emailExists, cnpjExists, whatsappExists] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.company.findUnique({ where: { cnpj }, select: { id: true } }),
      prisma.user.findFirst({ where: { whatsapp }, select: { id: true } }),
    ]);

    if (emailExists) {
      return errorResponse("Esse email já está cadastrado.", 409);
    }

    if (cnpjExists) {
      return errorResponse(CNPJ_DUPLICATE_MESSAGE, 409);
    }

    if (whatsappExists) {
      return errorResponse(DUPLICATE_WHATSAPP_MESSAGE, 409);
    }

    const companyData = await validateCnpjCompany(cnpj);
    const hash = await bcrypt.hash(password, 10);

    const user = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
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
      });

      const createdUser = await tx.user.create({
        data: {
          name,
          email,
          whatsapp,
          password: hash,
          role: "USER",
          active: true,
          companyId: company.id,
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

      await tx.routeCredit.create({
        data: {
          userId: createdUser.id,
          delta: 2,
          reason: "ADJUSTMENT",
          notes: "Créditos grátis de cadastro",
        },
      });

      return createdUser;
    });

    const isPending = companyData.cnpjVerificationStatus === "PENDING_VERIFICATION";

    return NextResponse.json(
      {
        ok: true,
        user,
        cnpjVerificationStatus: companyData.cnpjVerificationStatus,
        cnpjVerificationReason: companyData.cnpjVerificationReason,
        message: isPending ? PENDING_CNPJ_MESSAGE : null,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof CnpjValidationError) {
      return errorResponse(error.message, 400);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = Array.isArray(error.meta?.target) ? error.meta.target : [];
      if (target.includes("cnpj")) return errorResponse(CNPJ_DUPLICATE_MESSAGE, 409);
      if (target.includes("email")) return errorResponse("Esse email já está cadastrado.", 409);
      if (target.includes("whatsapp")) return errorResponse(DUPLICATE_WHATSAPP_MESSAGE, 409);
    }

    console.error("Erro public register:", error);
    return errorResponse("Erro ao criar conta.", 500);
  }
}
