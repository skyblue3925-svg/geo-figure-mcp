# geo-figure-mcp 원격 서버 (ChatGPT·Gemini·Claude 웹용)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY data ./data
COPY templates ./templates
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/http.js"]
