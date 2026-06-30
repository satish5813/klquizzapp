# API server image for the Hostinger VPS (Coolify / Docker).
# Builds only the Express backend — the React client is deployed separately to Vercel.
FROM node:20-alpine
WORKDIR /app

# install production deps only (express, cors, dotenv, mysql2, ...)
COPY package*.json ./
RUN npm install --omit=dev

# backend source
COPY server ./server

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server/index.js"]
