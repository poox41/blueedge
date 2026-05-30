FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_BFF_BASE_URL=/product-api/bff
ARG VITE_GATEWAY_BASE_URL=/product-api

ENV VITE_BFF_BASE_URL=$VITE_BFF_BASE_URL
ENV VITE_GATEWAY_BASE_URL=$VITE_GATEWAY_BASE_URL

COPY frontend/package*.json ./
RUN npm ci

COPY frontend .
RUN npm run build

FROM nginx:1.27-alpine

COPY deploy/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
