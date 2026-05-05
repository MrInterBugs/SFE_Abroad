FROM node:24-alpine AS base
WORKDIR /usr/src/app

FROM base AS deps
RUN apk add --no-cache python3 make g++
COPY ./student-loan-repayment/package.json ./student-loan-repayment/package-lock.json ./
RUN npm ci

FROM deps AS test
COPY ./student-loan-repayment ./
RUN --mount=type=secret,id=env,dst=/usr/src/app/.env npm test

FROM base AS prod-deps
RUN apk add --no-cache python3 make g++
COPY ./student-loan-repayment/package.json ./student-loan-repayment/package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && rm -rf \
    node_modules/better-sqlite3/deps \
    node_modules/better-sqlite3/src \
    node_modules/better-sqlite3/build/Release/obj \
    node_modules/better-sqlite3/build/Release/obj.target \
    node_modules/better-sqlite3/build/Release/sqlite3.a \
  && find node_modules -type f \( -name "*.map" -o -name "*.md" -o -name "*.d.ts" \) -delete

FROM base AS runtime-tools
RUN apk add --no-cache su-exec

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=test /usr/src/app/package.json /tmp/tested-package.json
COPY --from=runtime-tools /sbin/su-exec /sbin/su-exec
COPY --chown=node:node --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY --chown=node:node ./student-loan-repayment ./
COPY --chown=root:root --chmod=755 ./docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /usr/src/app/data \
  && chown node:node /usr/src/app/data

EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "app.js"]
