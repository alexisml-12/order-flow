# Etapa 1: instala solo las dependencias de producción.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Etapa 2: imagen final, mínima. No lleva el caché de npm ni nada de la etapa anterior.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Se ejecuta como el usuario "node" (sin privilegios de administrador).
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
