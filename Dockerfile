FROM node:25-alpine AS base
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
RUN npm ci --omit=dev && npm cache clean --force

FROM base AS runtime
ENV NODE_ENV=production

COPY --from=test /usr/src/app/package.json /tmp/tested-package.json
COPY --from=prod-deps /usr/src/app/node_modules ./node_modules
COPY ./student-loan-repayment ./

RUN mkdir -p /usr/src/app/data && chown -R node:node /usr/src/app

USER node
EXPOSE 3000

CMD ["node", "app.js"]
