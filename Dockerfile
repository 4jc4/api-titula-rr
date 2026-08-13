# syntax=docker/dockerfile:1

# ============================================================================
# api-titula-rr — imagem de produção
# O `src` existe SÓ no estágio builder: é compilado para dist/ e fica para
# trás. A imagem final roda JavaScript compilado, sem devDependencies.
# ============================================================================

# --- build ------------------------------------------------------------------
FROM node:24-slim AS builder
WORKDIR /app

# openssl: exigido pelo Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# O `prepare` do package.json roda o husky, que exige .git — excluído pelo
# .dockerignore. Em build não há hook de commit para instalar.
ENV HUSKY=0

# DATABASE_URL dummy: o prisma.config.ts a exige ao carregar, mas o
# `generate` do postinstall não conecta em banco nenhum.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# Remove as devDependencies do node_modules já instalado, em vez de um
# segundo `npm ci` no runtime: uma ida ao registry, não duas.
# O `prisma` CLI sobrevive (está em dependencies) — é ele que roda o
# `migrate deploy` dentro do container.
RUN npm prune --omit=dev

# --- runtime ----------------------------------------------------------------
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# Só o necessário para EXECUTAR: nada de src, nada de devDependencies.
COPY --from=builder /app/node_modules     ./node_modules
COPY --from=builder /app/dist             ./dist
COPY --from=builder /app/package.json     ./package.json
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/prisma           ./prisma
# raiz da CA corporativa — o AdValidator a lê em runtime (AD_CA_PATH)
COPY --from=builder /app/certs            ./certs

USER node
EXPOSE 3000

# Confira o caminho real com `ls dist/` depois do build: com prisma.config.ts
# na raiz a saída costuma ser dist/src/main.js; se for dist/main.js, ajuste.
CMD ["node", "dist/src/main.js"]