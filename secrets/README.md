# secrets/

Holds local secret files, one value per file, mounted into containers as
Docker secrets. Everything in this folder except this README is ignored by
Git.

For development, `npm run setup:dev` creates:

| File                          | Used by                                  |
| ----------------------------- | ---------------------------------------- |
| `postgres_superuser_password` | PostgreSQL container administration only |
| `lexora_owner_password`       | Migration commands (schema owner role)   |
| `lexora_app_password`         | The running API (least-privilege role)   |

Never copy development secrets to production. Production secrets are
created on the server during installation (Phase 9).
