FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
ENV PORT=4000
EXPOSE 4000
VOLUME ["/app/data"]
CMD ["node", "src/server.js"]
