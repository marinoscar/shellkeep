# Runbook: Re-encrypt the SSH Secrets into the Platform Credential Store

Use this **once per database**, when a ShellKeep build that stores SSH secrets in the platform credential store (issue #48) is deployed against a database whose server profiles still hold their secrets in the legacy columns. It copies every password, private key and passphrase from `server_profiles.encrypted_password`, `encrypted_private_key` and `encrypted_passphrase` (AES-256-GCM under the legacy `ENCRYPTION_KEY`) into the platform's per-user credential store (purpose `ssh`, encrypted under `SECRETS_ENCRYPTION_KEY`, one sub-key per user and purpose).

The production run is sequenced inside the #32 release train by #84. Later rotations of `SECRETS_ENCRYPTION_KEY` follow the platform's runbook: [rotate-secrets-encryption-key.md](https://github.com/marinoscar/EnterpriseAppBase/blob/main/docs/runbooks/rotate-secrets-encryption-key.md) (it re-encrypts all three credential tables, `user_credentials` included).

## What changes

| | Before (legacy) | After (#48) |
|---|---|---|
| Where a secret lives | three nullable text columns of `server_profiles` | `user_credentials` rows, purpose `ssh`, name `profile.<profileId>.password`, `.private_key`, `.passphrase` |
| Key | `ENCRYPTION_KEY`, one key, no purpose or owner binding (a ciphertext copied to another user's row decrypts) | `SECRETS_ENCRYPTION_KEY` with an owner-bound sub-key `user:<userId>:ssh` (a ciphertext moved to another user fails authentication) |
| Read by | the API, at connect time | the API, at connect time, through `UserCredentialsService.getSecret` |
| Fallback | none | none: the `ssh` purpose has no organization or deployment fallback |

The legacy columns are **left in place and no longer read or written**. A later migration drops them only after production verification (#84). `ENCRYPTION_KEY` stays in the environment, used by this command only, until then.

## The command

`npm run ssh:migrate-secrets` (from `apps/api`; inside the production image the same script runs the compiled file). Three modes:

| Mode | Command | Writes? |
|---|---|---|
| Dry run (default) | `npm run ssh:migrate-secrets` | no |
| Apply | `npm run ssh:migrate-secrets -- --apply` | creates the missing credentials |
| Verify | `npm run ssh:migrate-secrets -- --verify` | no |

It reads the database from `POSTGRES_*` and needs **both** keys in the environment: `ENCRYPTION_KEY` (legacy, base64 of 32 bytes or a raw 32-character string, as it has always been accepted) and `SECRETS_ENCRYPTION_KEY` (base64 of 32 bytes). It exits `0` when no row needs attention, `1` when one does, `2` for a usage or configuration error.

- **Dry run.** For every non-null legacy column it counts: *to copy* (decryptable, no credential yet), *already copied* (a credential exists) and *undecryptable* (wrong key, malformed or blank), with the profile id and field of each undecryptable value and a fixed reason code (`auth-failed`, `bad-format`, `blank`). It never prints a plaintext or a ciphertext.
- **Apply.** For each field *to copy* it decrypts with the legacy cipher, stores it with `setSecret`, reads it back with `getSecret` and compares; a copy that does not read back equal is removed and counted as failed. It never overwrites an existing credential, so it is **idempotent** and a re-run copies only what is missing. Undecryptable values are reported and skipped.
- **Verify.** Re-reads every pair and prints, per field, `source N = target N`. A pair whose credential is missing or differs is listed by profile id and field. `source` counts the legacy values that decrypt; undecryptable ones are counted on their own and keep the exit code at `1`.

## 1. Preconditions

1. **Both keys are set** where the command runs, and `SECRETS_ENCRYPTION_KEY` is the value the API will run with. The API refuses to start with a missing or malformed `SECRETS_ENCRYPTION_KEY` once any credential is stored. Never change it after `--apply` without the rotation runbook: every credential stored under the old key becomes unreadable.
2. **A fresh backup** of the database: `pg_dump -Fc "$POSTGRES_DB" > shellkeep-before-ssh-reencryption.dump`. The dump holds the legacy ciphertexts and, after the apply, the new ones: store it like production data.
3. **The migrations are applied** (`npm run prisma:migrate`): `user_credentials` must exist (platform migration `0018`). The build is the one that contains this command and the credential-store code.
4. **Record the counts** to compare later:

   ```sql
   SELECT count(*) AS profiles,
          count(encrypted_password)    AS passwords,
          count(encrypted_private_key) AS private_keys,
          count(encrypted_passphrase)  AS passphrases
   FROM server_profiles;
   ```

## 2. Rehearse on a restored copy

Production is touched only after the whole procedure has run clean on a copy.

1. `pg_dump -Fc` the production database.
2. On a **trusted non-production cluster** (the copy holds production SSH ciphertexts: never a laptop; drop it afterwards): `createdb shellkeep_rehearsal` and `pg_restore --no-owner --no-acl -d shellkeep_rehearsal <dump>`, then apply the migrations to it (`npm run prisma:migrate`, as [database-baseline.md](database-baseline.md) describes for an existing database).
3. Point a shell at the copy and **check twice**, because every step below writes to whatever these name:

   ```bash
   export POSTGRES_HOST=... POSTGRES_PORT=... POSTGRES_USER=... POSTGRES_PASSWORD=... POSTGRES_DB=shellkeep_rehearsal
   export ENCRYPTION_KEY=...            # the legacy key, the production value
   export SECRETS_ENCRYPTION_KEY=...    # the rehearsal's own key: never reuse production's on a copy
   cd apps/api
   ```
4. Run sections 3 to 6 on the copy, then section 7 against an API started on the copy, with profiles that point at a **test SSH target**.
5. Keep the three reports. The production run must print the same shape of report; a difference means the copy is not faithful.

## 3. Dry run

```bash
npm run ssh:migrate-secrets
```

Expected: `DRY RUN (nothing written)`, `profiles scanned: N`, then one line per field:

```
  password    legacy values 1: to copy 1, already copied 0, undecryptable 0
  private_key legacy values 1: to copy 1, already copied 0, undecryptable 0
  passphrase  legacy values 0: to copy 0, already copied 0, undecryptable 0
```

and `RESULT: ok`. The `legacy values` counts must equal the `passwords`, `private_keys` and `passphrases` of precondition 4. **Stop on any `undecryptable`**: the lines below the counts name the profile id, the field and the reason. `auth-failed` means that value was not encrypted under the `ENCRYPTION_KEY` in use (check you are using the production value, then the profile's history); `bad-format` and `blank` mean the column holds something that was never a ciphertext. Fix or accept each one deliberately (a profile whose secret cannot be recovered is edited by its owner in the UI, which stores a new one), then dry-run again.

## 4. Apply

```bash
npm run ssh:migrate-secrets -- --apply
```

Expected: `APPLY`, `copied` counts equal to the dry run's `to copy`, `failed 0`, `RESULT: ok`. Re-running it prints `copied 0, already copied N`. A `failed` value is a store error or a read-back mismatch: nothing was left behind for it; fix the cause (the API log names the credential address, never a secret) and re-run.

## 5. Verify

```bash
npm run ssh:migrate-secrets -- --verify
```

Expected, per field `source N = target N` and `RESULT: ok`. Any `!=` or a profile listed as `missing` or `differs` blocks the release.

## 6. Production, inside the release train (#84)

The legacy columns stay, so the previous build keeps working until the very end. The order avoids a window in which a profile has no usable secret:

1. Maintenance window. Back up (precondition 2). Add `SECRETS_ENCRYPTION_KEY` to the deployment's `.env` next to the existing `ENCRYPTION_KEY`.
2. Build the new API image **without restarting the stack**: `docker compose -f /opt/infra/apps/shellkeep/compose.yml build api`.
3. Run the migrations the new build needs (`user_credentials` exists since platform `0018`; `shellkeep deploy update` runs the migrate step for the same reason), then the command from the **new image** against the live database while the old API still serves:

   ```bash
   docker compose -f /opt/infra/apps/shellkeep/compose.yml run --rm --no-deps api npm run ssh:migrate-secrets
   docker compose -f /opt/infra/apps/shellkeep/compose.yml run --rm --no-deps api npm run ssh:migrate-secrets -- --apply
   docker compose -f /opt/infra/apps/shellkeep/compose.yml run --rm --no-deps api npm run ssh:migrate-secrets -- --verify
   ```

   The old build ignores the new rows, so nothing changes for users yet.
4. `shellkeep deploy update` (restarts the API on the new build). From this moment the API reads the credential store.
5. Section 7 on production with one profile per authentication method.

## 7. Check that every profile connects

With the API running on the new build:

1. `GET /api/server-profiles` (as the profile's owner): each migrated profile reports `hasPassword`, `hasPrivateKey` or `hasPassphrase` as `true` where it has that secret, and no response carries a secret.
2. `POST /api/server-profiles/<id>/test` for **every** profile (or, on a large fleet, one per owner and authentication method): `{ "success": true }`.
3. Open a terminal session on one profile of each method.
4. `psql`: `SELECT purpose, count(*) FROM user_credentials GROUP BY purpose;` shows `ssh` with the number of migrated fields. The API log shows `Stored user credential "ssh/profile.<id>.<field>" for user <id>` lines (from the apply) and no secret, hint or ciphertext.

## 8. Key loss and rollback

- **Lost `SECRETS_ENCRYPTION_KEY` after the apply.** The credentials cannot be decrypted. The legacy columns still hold the original ciphertexts: restore the key if it exists anywhere (secret manager, previous `.env`); otherwise `DELETE FROM user_credentials WHERE purpose = 'ssh'`, set a new key and run `--apply` again from the legacy columns (needs `ENCRYPTION_KEY`).
- **Lost `ENCRYPTION_KEY` before the apply.** The legacy values are undecryptable: owners re-enter their secrets in the UI (the new code stores them in the credential store directly).
- **Roll back the code.** Revert to the previous image. It reads the legacy columns, which were never changed, with `ENCRYPTION_KEY`. Secrets entered or changed while the new build ran exist only in the credential store; they are not copied back, so re-enter them if the roll-back is long-lived.
- **Start the copy over.** `DELETE FROM user_credentials WHERE purpose = 'ssh';` then `--apply` again. Nothing else is touched.
- **After production verification** (#84) a migration drops the three legacy columns and `ENCRYPTION_KEY` leaves the environment. Until then do not remove either.

## Security notes

- The command prints counts, profile ids, field names and fixed reason codes. It never prints a plaintext, a ciphertext, a hint or an error message from the cipher; an unexpected failure prints one line with the error's class and code (for example `PrismaClientInitializationError`) and no message.
- The credential store logs `Stored credential "ssh/<name>" for user <id>` and nothing else. The hint column of a stored credential keeps the last four characters of a secret of eight or more characters (a platform behaviour); it is never returned by any ShellKeep endpoint.
- A rehearsal copy holds production ciphertexts and, after `--apply`, secrets re-encrypted under the rehearsal's own key. Drop it when done.
