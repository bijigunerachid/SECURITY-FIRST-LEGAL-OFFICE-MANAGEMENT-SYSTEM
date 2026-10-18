# Moroccan privacy and legal checklist

**This is not legal advice.** It lists questions that the lawyer, or a
qualified Moroccan privacy professional, must answer before Lexora processes
real client data. The references below are starting points to verify, not
conclusions. Hosting the data in Morocco or encrypting it does not, by
itself, satisfy these obligations.

The sign-off at the end is part of the
[production gate](roadmap.md#production-gate).

## 1. Personal data protection (Law 09-08 and the CNDP)

- [ ] Does the office's processing require a prior **declaration** to the
      CNDP, or a prior **authorization**? Note that Lexora processes data
      about legal proceedings and possibly offences, which the law treats
      specially.
- [ ] Has the CNDP issued deliberations or standard forms for law offices or
      auxiliaries of justice that apply here?
- [ ] What is the lawful basis for each category of data (clients, opposing
      parties, witnesses, staff)?
- [ ] How are the people concerned informed? Is a privacy notice needed for
      clients, and how are opposing parties and third parties handled?
- [ ] How are the rights of access, rectification and objection handled, and
      how do they fit with professional secrecy?
- [ ] Is a register of processing activities expected, and who keeps it?
- [ ] Has any reform replacing or amending Law 09-08 come into force?

## 2. Professional secrecy

- [ ] Which obligations apply to the office and its staff (law organizing the
      legal profession, Law 28-08; Penal Code article 446 on professional
      secrecy; Bar rules)?
- [ ] Which staff roles may see which information? Does this match the
      [authorization model](security.md#authorization)?
- [ ] May an administrator (possibly a non-lawyer or an IT contractor) ever
      access matter content? This sets decision D2.
- [ ] Do staff and any IT contractor sign confidentiality undertakings?

## 3. Retention and deletion

- [ ] How long must matter files be kept after a matter closes? Check Bar
      guidance.
- [ ] How long must accounting records and invoices be kept? The Commercial
      Code is usually read as requiring 10 years; confirm.
- [ ] How long should audit logs and backups be kept?
- [ ] What must happen at the end of the retention period: deletion,
      anonymization or archive?
- [ ] Who may approve early deletion, and how is it recorded?

## 4. Hosting, providers and transfers

- [ ] Will any provider outside Morocco process or store data (cloud backup,
      email, support, monitoring)? Transfers abroad may need CNDP
      authorization unless an exception applies.
- [ ] Is a written agreement with each provider or IT contractor needed, and
      what must it contain?
- [ ] Is the development repository free of real client data? (Required by
      project rules; confirm the office accepts code being hosted on GitHub.)

## 5. Invoices and financial records

Only if invoicing is used in Lexora (Phase 7):

- [ ] Required invoice details (ICE, IF, tax identifiers, VAT rate and
      amounts, client details).
- [ ] Numbering rules (sequential, no gaps, how cancellations and credit notes
      work).
- [ ] Any current or upcoming electronic invoicing requirement from the DGI.
- [ ] Rules for handling client funds, if the app records them.

## 6. Other laws to check

- [ ] Law 05-20 on cybersecurity: does it apply to the office?
- [ ] Law 43-20 on electronic trust services: relevant if electronic
      signatures or timestamps are added.
- [ ] Any Bar requirement about where and how client files are stored.

## 7. Security incidents

- [ ] Who decides that an incident has happened?
- [ ] Who must be informed (clients, CNDP, the Bar, others), and how quickly?
- [ ] Who keeps the incident record?

## Sign-off

| Item                                                         | Answer recorded | Reviewed by | Date |
| ------------------------------------------------------------ | --------------- | ----------- | ---- |
| Sections 1–7 reviewed                                        |                 |             |      |
| Retention periods confirmed and recorded in the architecture |                 |             |      |
| Decision D2 (admin access to matter content) confirmed       |                 |             |      |
| Approval to process real client data                         |                 |             |      |
