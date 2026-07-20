# Security policy

Please do **not** open a public GitHub issue for a vulnerability. Email
**mustafa@mustafaerbay.com.tr** instead. [Türkçe](SECURITY.tr.md)

If possible, encrypt the report with the maintainer's key at
[keys.openpgp.org](https://keys.openpgp.org/search?q=mustafa@mustafaerbay.com.tr).

## Response targets

| Stage | Target |
|---|---|
| Initial acknowledgement | 48 hours |
| Triage and reproduction | 1 week |
| Fix and deployment | severity-dependent; critical issues target 72 hours |

## In scope

RCE, SQL injection, XSS, SSRF, authentication bypass, magic-link/session token
leak or replay, moderation bypass and rate-limit bypass affecting
`https://burncpu.com`.

## Out of scope

Spam reports (use the in-app flag), DoS/DDoS, public CVEs in third-party
libraries before upstream coordination, social engineering and physical attacks.

## Safe harbor

Good-faith research is welcome when you use only your own test account, do not
access or alter other users' data, do not harm confidentiality/integrity/
availability, do not run automated load or DoS tests, and allow coordinated
disclosure time before publishing. Raw scanner output without context or a
reproducible impact is not actionable.

See [THREAT_MODEL.md](THREAT_MODEL.md) for trust boundaries and accepted risks.

## Hall of fame

Valid reporters will be listed here. (Currently empty — you could be first. 🐢)
