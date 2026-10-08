# Agent Flux V2 - Phase 1

## Setup Instructions

1. Install dependencies: `pnpm install`
2. Setup environment variables: `cp .env.example .env`
3. Start local Postgres database
4. Push Prisma schema: `pnpm db:push`
5. Generate Prisma client: `pnpm db:generate`
6. Start dev servers: `pnpm dev`
