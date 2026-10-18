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

Permissions (Linux and macOS): the folder is `0700`, so other users on the
machine cannot open it, and each file is `0644`. Files must be readable
inside the database container, where they are read by the container's
`postgres` user rather than by you. With `0600` files, the database starts
without the Lexora roles. If you created the files another way, run
`chmod 700 secrets && chmod 644 secrets/*_password`.

Never copy development secrets to production. Production secrets are
created on the server during installation (Phase 9).
