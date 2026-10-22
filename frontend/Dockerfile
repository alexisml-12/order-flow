# Etapa 1: compila la aplicación React (genera archivos estáticos en /app/dist).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Dirección de la API que usará el navegador. Se "graba" dentro de los archivos compilados.
ARG VITE_API_URL
RUN npm run build

# Etapa 2: imagen final. nginx solo sirve los archivos ya compilados (sin Node ni node_modules).
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
