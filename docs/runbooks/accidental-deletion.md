# Something was deleted or changed by mistake

Lexora keeps most history on purpose, so most mistakes are undone inside
the app:

| What happened                     | Where it still is                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A document "deleted"              | It is hidden, not erased: the file and its versions stay. Ask the technical contact to un-hide it (database, see below). |
| A new version replaced a document | Older versions stay available in the document's versions list.                                                           |
| A matter closed by mistake        | Edit the matter and set its status back.                                                                                 |
| A hearing cancelled by mistake    | Edit the hearing and set its status back.                                                                                |
| A task or deadline deleted        | Not kept: re-create it. The audit log shows who deleted what and when (`task.delete`).                                   |
| An invoice issued with an error   | Issued invoices never change: issue a credit note (avoir), then a new invoice.                                           |
| A payment recorded by mistake     | Void it with a reason (_Annuler le règlement_).                                                                          |
| A party or team member removed    | Add them again.                                                                                                          |

## Un-hiding a document

On the server, with the document's ID (from the audit log entry
`document.delete`):

```sh
lexora exec -T db psql -U postgres -d lexora -c \
  "UPDATE document SET deleted_at = NULL, deleted_by_id = NULL WHERE id = '<document id>'"
```

Write the reason in the incident record: this change bypasses the app and
is not in Lexora's audit log.

## Older data from a backup

If something is genuinely gone (for example a field overwritten days ago),
restore a snapshot from the right night into an **isolated** test database
([backups.md](../operations/backups.md)), look the value up there, and
re-enter it in Lexora by hand. Never copy a whole backup over the live
database to recover one record: everything entered since would be lost.
