FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts ./scripts
COPY worker ./worker
COPY web ./web
RUN npm run build:worker

FROM node:24-alpine
WORKDIR /app
ARG RELEASE=unknown
ENV NODE_ENV=production RELEASE=$RELEASE
COPY --from=build /app/package.json ./package.json
COPY --from=build --chown=node:node /app/build/worker.js ./build/worker.js
COPY --chown=node:node server/app.js server/http-adapter.js ./server/
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/app.js"]
