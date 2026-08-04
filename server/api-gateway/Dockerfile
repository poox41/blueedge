FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine

RUN apk add --no-cache curl helm tar

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/prepare-kubeedge-charts.sh /usr/local/bin/prepare-kubeedge-charts
RUN chmod +x /usr/local/bin/prepare-kubeedge-charts && /usr/local/bin/prepare-kubeedge-charts /opt/blueedge/kubeedge-charts && chown -R node:node /opt/blueedge

USER node
EXPOSE 7001

CMD ["node", "dist/index.js"]
