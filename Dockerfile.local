FROM oven/bun:1.3.14

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile
RUN bun run build

CMD ["bun", "run", "--cwd", "apps/platform-service", "start"]
