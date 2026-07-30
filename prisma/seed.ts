import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import 'dotenv/config';
import {
  OrigemConta,
  Papel,
  PrismaClient,
} from '../src/generated/prisma/client.js';

// Cria/atualiza a conta break-glass (origem LOCAL).
// A senha vem do .env e NUNCA é impressa nem commitada.
const username = process.env.BREAK_GLASS_USER ?? 'resgate.local';
const password = process.env.BREAK_GLASS_PASSWORD;

if (!password || password.length < 16) {
  console.error(
    '❌ Defina BREAK_GLASS_PASSWORD no .env (mínimo 16 caracteres).',
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const passwordHash = await argon2.hash(password);

await prisma.user.upsert({
  where: { username },
  create: {
    username,
    name: 'Conta de Emergência (break-glass)',
    origem: OrigemConta.LOCAL,
    passwordHash,
    papeis: [Papel.administrador],
  },
  update: { passwordHash },
});

console.log(`✅ Conta break-glass '${username}' pronta.`);
await prisma.$disconnect();
