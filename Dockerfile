# geo-figure-mcp 원격 서버 (ChatGPT·Gemini·Claude 웹용)
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk fontconfig && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY data ./data
COPY templates ./templates
ENV PORT=8080
EXPOSE 8080
CMD ["/bin/sh", "-c", "\
if command -v gs >/dev/null 2>&1; then \
  status=installed; \
elif packages=$(dpkg-query -W -f='${binary:Package} ${db:Status-Status}\\n' 2>/dev/null); then \
  if printf '%s\\n' \"$packages\" | grep -Eq '^(ghostscript|libgs[0-9]+)(:[^ ]+)? installed$'; then \
    status=installed; \
  else \
    status='not installed'; \
  fi; \
else \
  status=unknown; \
fi; \
printf 'Ghostscript: %s\\n' \"$status\"; \
exec node src/http.js"]
