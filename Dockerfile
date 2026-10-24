# Runs tokensave-mcp-diet in front of Playwright MCP (headless).
# Listing the tools does not start a browser; to use the browser tools inside
# the container, also run `npx playwright install --with-deps chromium`.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY index.js slim.js text.js ./
ENTRYPOINT ["node", "index.js", "--", "node_modules/.bin/playwright-mcp", "--headless", "--no-sandbox"]
