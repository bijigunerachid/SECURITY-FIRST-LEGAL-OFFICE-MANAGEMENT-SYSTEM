# 0001 — Modular monolith and technology stack

Status: Accepted (2026-10-18)

## Context

One law office, a small number of users, one server, no dedicated operations
staff. The data is highly confidential. Every extra service adds credentials,
network paths and things to patch and back up.

## Decision

Build a modular monolith: one Express API, one background worker from the
same code base, one PostgreSQL database, organised by business module.

Stack: React, TypeScript (strict), Vite, Tailwind CSS, shadcn/ui, React
Router, TanStack Query, React Hook Form, Zod on the web; Node.js LTS,
TypeScript, Express, Prisma, Zod, Pino on the API; Docker Compose for
deployment. npm workspaces, because npm is already installed and adds no new
tool.

## Alternatives considered

- **Microservices**: rejected; more attack surface and operations work with
  no benefit at this scale.
- **Full-stack framework (Next.js, Remix)**: rejected; server rendering and
  framework-managed endpoints make it harder to keep all authorization in one
  reviewed API layer, and the requested stack is React with Express.

## Consequences

- One deployment unit to secure, test and back up.
- Module boundaries must be kept by convention and code review.
- The API and web app are served from one origin, so no CORS is needed.
