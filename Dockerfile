FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY index.js ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN apk add --no-cache su-exec \
    && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /config
ENV NODE_ENV=production PORT=13000 CONFIG_DIR=/config PUID=99 PGID=100
EXPOSE 13000
VOLUME ["/config"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:13000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
