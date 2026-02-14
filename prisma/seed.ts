import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
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