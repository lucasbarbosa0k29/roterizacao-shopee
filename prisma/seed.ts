import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();
const isProduction = process.env.NODE_ENV === "production";
const DEFAULT_DEV_ADMIN_EMAIL = "admin@admin.com";
const DEFAULT_DEV_ADMIN_PASSWORD = "123456";

function getSeedAdminCredentials() {
  const email = String(process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  const password = String(process.env.SEED_ADMIN_PASSWORD || "");

  if (isProduction) {
    if (!email) {
      throw new Error("SEED_ADMIN_EMAIL é obrigatório em produção.");
    }

    if (!password || password.length < 12) {
      throw new Error(
        "SEED_ADMIN_PASSWORD é obrigatório em produção e deve ter no mínimo 12 caracteres."
      );
    }

    return { email, password };
  }

  return {
    email: email || DEFAULT_DEV_ADMIN_EMAIL,
    password: password || DEFAULT_DEV_ADMIN_PASSWORD,
  };
}

async function upsertSubscriptionPlans() {
  await prisma.subscriptionPlan.upsert({
    where: { code: "FREE" },
    update: {
      name: "FREE",
      durationDays: null,
      dailyRouteLimit: 0,
      isUnlimited: true,
      isActive: true,
    },
    create: {
      code: "FREE",
      name: "FREE",
      durationDays: null,
      dailyRouteLimit: 0,
      isUnlimited: true,
      isActive: true,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { code: "BASIC" },
    update: {
      name: "Plano Básico",
      durationDays: 30,
      dailyRouteLimit: 1,
      isUnlimited: false,
      isActive: true,
    },
    create: {
      code: "BASIC",
      name: "Plano Básico",
      durationDays: 30,
      dailyRouteLimit: 1,
      isUnlimited: false,
      isActive: true,
    },
  });

  await prisma.subscriptionPlan.upsert({
    where: { code: "PRO" },
    update: {
      name: "Plano Pro",
      durationDays: 30,
      dailyRouteLimit: 2,
      isUnlimited: false,
      isActive: true,
    },
    create: {
      code: "PRO",
      name: "Plano Pro",
      durationDays: 30,
      dailyRouteLimit: 2,
      isUnlimited: false,
      isActive: true,
    },
  });
}

async function main() {
  await upsertSubscriptionPlans();

  const { email, password } = getSeedAdminCredentials();

  const hash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      password: hash,
      role: "ADMIN",
      active: true,
    },
    create: {
      email,
      password: hash,
      role: "ADMIN",
      active: true,
      name: "Administrador",
    },
  });

  console.log("✅ Admin pronto:", admin.email);
}

main()
  .catch((e) => {
    console.error("❌ Erro no seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
