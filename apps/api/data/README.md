# apps/api/data

## common-passwords-15plus.txt.gz

Passwords that appear in public breach corpora and are at least 15
characters long (Lexora's minimum length), lowercased, deduplicated and
sorted, one per line, gzip-compressed. New passwords are rejected if their
lowercased form is in this list (NIST SP 800-63B-4: check against values
known to be commonly used or compromised). No external service is contacted.

| Property       | Value                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Source         | SecLists, `Passwords/Common-Credentials/Pwdb_top-10000000.txt` (https://github.com/danielmiessler/SecLists), downloaded 2026-10-18 |
| Source SHA-256 | `18dc49ca32b62455a61e3398f4ab9f93eb700ff142fa0d4b9fd11a727f3b80e4`                                                                 |
| License        | MIT (SecLists)                                                                                                                     |
| Entries        | 122,630                                                                                                                            |
| File SHA-256   | `8cd18982161488fabcf310b6c90bd687d5e38102c06c7f0e289c1a6b3bd8e90f`                                                                 |

Regenerate (POSIX shell) when the minimum length or source changes:

```sh
tr -d '\r' < Pwdb_top-10000000.txt \
  | awk 'length($0) >= 15 && length($0) <= 128' \
  | tr 'A-Z' 'a-z' | LC_ALL=C sort -u \
  | gzip -9 -n > common-passwords-15plus.txt.gz
```
