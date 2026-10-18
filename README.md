# Lexora

Lexora is a security-first management system for a single law office in
Morocco: clients, matters, documents, hearings, invoices and payments, in
French and Arabic.

> **Status: design phase.** There is no application code yet. Do not enter
> real client data into any version of Lexora until the
> [production gate](docs/roadmap.md#production-gate) has been passed.

## Documentation

| Document | Contents |
|---|---|
| [Roadmap](docs/roadmap.md) | Phases, status, open decisions, production gate, verification log |
| [Architecture](docs/architecture.md) | Components, technology, request flow, environments |
| [Threat model](docs/threat-model.md) | Assets, trust boundaries, threats, risk register, residual risks |
| [Security design](docs/security.md) | Authentication, sessions, authorization, documents, encryption, logging |
| [Privacy and legal checklist](docs/privacy-checklist.md) | Questions for a Moroccan legal or privacy professional |
| [Decision records](docs/decisions/) | Why the main technical choices were made |

## Principles

- Deny by default. A valid login never grants access to every record.
- No public registration and no public internet exposure.
- No secrets in Git. Settings live in ignored env files and Docker secrets,
  validated at startup.
- Synthetic data only outside production.
- Every change ships with tests, and security claims are backed by tests
  that were actually run.

## Repository setup

Line endings are normalised to LF by `.gitattributes`, so scripts work the
same in Linux containers as on Windows.

Development setup instructions arrive with the foundation phase.

## Reporting a security problem

Report suspected vulnerabilities privately to the repository owner. Do not
open a public issue, and never include real client data.
