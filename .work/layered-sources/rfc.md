# RFC — Implement ADR-0008: install from layered sources, last path wins

- **Status**: implementing
- **Autonomy**: L3
- **Repository**: git@github.com:dohrm/claude-rules.git
- **Base branch**: next
- **Branch**: rfc/layered-sources
- **Ticket**: https://github.com/dohrm/claude-rules/issues/33

## Blocked on the human

- The stopping condition passes without its witness (missing test file ignored by `node --test`); amend it, then raise the level back if wanted — see the ticket.
