# Trial user security & behavior report

**Date:** 2026-02-10
**Author:** GitHub Copilot (automated scan)

## Summary
This document captures critical findings related to trial users, automatic role demotion, and related API behavior. These notes should be preserved for security reviews and used as a checklist when implementing fixes/tests.

## Findings (critical)
1. Unprotected user creation (high)
   - POST `/users` (router.post('/', createUser)) is publicly accessible and allows callers to set `role` and `trial_user` fields.
   - Files: `src/routes/users.js` (router.post('/', createUser)), `src/controllers/userController.js` (`createUser` handler).
   - Risk: an attacker or malicious client can create users with elevated privileges or trial state without authorization.

2. Server trusts frontend for `trial_user` (high)
   - Both `register` and `createUser` set `trial_user` from `req.body.trial_user === true`.
   - Files: `src/controllers/userController.js` (functions `register` and `createUser`), `src/models/user.js` defines `trial_user` boolean.
   - Risk: client can claim trial status; server-side decisions should not rely on untrusted input.

3. Inconsistent comment vs code (low/medium)
   - Login comment says "7 günü geçtiyse" but code checks `diffDays > 30`.
   - File: `src/controllers/userController.js` (login).
   - Action: fix comment and consider moving the duration to config.

4. Missing tests for demotion and side-effects (medium)
   - No automated test currently verifies that: when `trial_user=true` and createdAt is older than the threshold, login demotes role to `guest` and clears `offline_enabled`.
   - Action: add unit/integration test(s) to assert role and `offline_enabled` behavior.

5. Guest restrictions applied broadly (informational)
   - `guestRestrictionMiddleware` blocks `guest` users on many routes; correct behavior depends on reliable demotion logic.
   - Files: `src/middleware/auth.js` and many route files under `src/routes/`.

## Recommended fixes (priority order)
1. Immediate (high)
   - Protect `POST /users` endpoint: require authorization (e.g., `authMiddleware` + role check such as `superadmin` or `leader`) for creating users via `createUser`. Update routes accordingly.
   - Disallow `trial_user` and `role` assignment from unprivileged requests. For `register`, force `trial_user: false` server-side.

2. Short-term (medium)
   - Make demotion threshold (30 days) a configurable constant (e.g., `process.env.TRIAL_DAYS || 30`) and replace magic number in code; correct the comment.
   - Ensure when demoting to `guest`, `offline_enabled` is set to `false` (already added to `login`), and consider adding an audit log entry when demotion occurs.

3. Tests (medium)
   - Add tests to verify:
     - `register` ignores client-supplied `trial_user`.
     - Admin `createUser` can set `trial_user` only when called by an authorized user.
     - Login demotion: a `trial_user` with old `createdAt` is demoted to `guest` and `offline_enabled` becomes `false`.
     - `guestRestrictionMiddleware` behavior with demoted users.

4. Misc
   - Add a migration or a maintenance job to find and correct inconsistent `trial_user` records if needed.
   - Add a short section in security checklist to periodically review routes that accept sensitive flags from clients.

## Suggested PR checklist
- [ ] Add route protection for `POST /users` and add unit test for unauthorized creation.
- [ ] Change `register` to set `trial_user:false` unconditionally and add tests.
- [ ] Ensure `createUser` only accepts `trial_user` when caller has appropriate role; add tests.
- [ ] Move trial length to config and update comment.
- [ ] Add tests for demotion side-effects (`role`, `offline_enabled`).
- [ ] Document changes in a security changelog.

---

_Keep this file as part of the repo for future audits and track PRs referencing it._
