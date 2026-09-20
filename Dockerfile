FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm test
RUN npm run build
RUN npm prune --omit=dev \
  && rm -rf \
    node_modules/@jup-ag/lend-read/node_modules/unbuild \
    node_modules/@jup-ag/lend-read/node_modules/vitest \
    node_modules/unbuild \
    node_modules/vitest \
    node_modules/rollup \
    node_modules/esbuild \
    node_modules/vite \
    node_modules/tsx

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
RUN groupadd --system --gid 10001 solwallet \
  && useradd --system --uid 10001 --gid 10001 --create-home --home-dir /home/solwallet solwallet \
  && mkdir -p /home/solwallet/.config/sol-wallet \
  && chown -R solwallet:solwallet /home/solwallet
COPY --from=build --chown=solwallet:solwallet /app/package.json ./
COPY --from=build --chown=solwallet:solwallet /app/node_modules ./node_modules
COPY --from=build --chown=solwallet:solwallet /app/dist ./dist

ENV NODE_ENV=production
ENV HOME=/home/solwallet
ENV SOL_WALLET_CONFIG_DIR=/home/solwallet/.config/sol-wallet
USER solwallet
ENTRYPOINT ["node", "/app/dist/cli.js"]
