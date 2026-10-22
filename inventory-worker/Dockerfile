# Etapa 1: instala solo las dependencias de producción.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Instala exactamente lo que dice package-lock.json y sin dependencias de desarrollo.
RUN npm ci --omit=dev 

# Etapa 2: imagen final, mínima. El worker no expone ningún puerto: solo consume mensajes.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Ejecuta la aplicación sin permisos de administrador.
USER node
CMD ["node", "src/index.js"]
