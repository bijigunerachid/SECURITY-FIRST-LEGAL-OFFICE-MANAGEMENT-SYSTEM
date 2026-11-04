# Runbooks

What to do when something goes wrong. Each runbook is a checklist: work
through it in order, write down what you did and when (the incident
record), and keep it with the office's records.

| Situation                                                        | Runbook                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| The server (or a backup drive) is lost or stolen                 | [stolen-server.md](stolen-server.md)                     |
| A password, second factor or computer may be in someone's hands  | [compromised-credentials.md](compromised-credentials.md) |
| Files are encrypted or the server behaves strangely (ransomware) | [ransomware.md](ransomware.md)                           |
| A document, matter or record was deleted or changed by mistake   | [accidental-deletion.md](accidental-deletion.md)         |

Lexora's own alerts (menu **Alertes**, administrators) point to these
runbooks:

| Alert                                            | Start with                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Échecs de connexion répétés (account or address) | compromised-credentials.md, section 1                                               |
| Accès refusés répétés                            | compromised-credentials.md, section 2                                               |
| Accès d'urgence utilisé                          | Check the reason with the administrator; if unexplained, compromised-credentials.md |
| Journal d'audit modifié                          | ransomware.md (treat as a break-in until proven otherwise)                          |
| Sauvegarde en échec / en retard                  | [../operations/backups.md](../operations/backups.md); fix within the day            |

Personal data breach: Moroccan law 09-08 and the CNDP's rules may require
notification. Check with the office's legal adviser as soon as client data
may have been exposed (see the [privacy checklist](../privacy-checklist.md)).
