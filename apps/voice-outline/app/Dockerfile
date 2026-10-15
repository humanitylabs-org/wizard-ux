FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs realtime.mjs audio.mjs ./
COPY web ./web
ENV BIND=0.0.0.0 PORT=8799 OUTLINE_DATA=/data
EXPOSE 8799
CMD ["node","server.mjs"]
