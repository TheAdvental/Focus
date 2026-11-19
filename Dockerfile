FROM node:22-alpine
WORKDIR /app
COPY server/server.js server/mcp-tools.js ./
COPY index.html ./public/index.html
RUN mkdir /data && chown node:node /data
ENV DATA_DIR=/data PORT=8080
VOLUME /data
EXPOSE 8080
USER node
CMD ["node", "server.js"]
