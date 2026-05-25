import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

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

  const email = "admin@admin.com";
  const senha = "123456";

  const hash = await bcrypt.hash(senha, 10);

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
