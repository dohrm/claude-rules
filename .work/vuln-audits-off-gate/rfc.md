# RFC pointer — see the ticket

- **Status**: implementing
- **Autonomy**: L4
- **Repository**: git@github.com:dohrm/claude-rules.git
- **Base branch**: next
- **Branch**: rfc/vuln-audits-off-gate
- **Ticket**: https://github.com/dohrm/claude-rules/issues/50

## Blocked on the human

- ⏸ hold: check the merge-base audit on a Gitea consumer repo (with `fetch-depth: 0`).
- Accept or revert `changed:` fetch-depth 0 on the gate checkouts.
- Merge `rfc/vuln-audits-off-gate` into `next`.
