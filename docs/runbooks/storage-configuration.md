# Runbook: Configure Object Storage

Object storage is **runtime configuration**, edited by an administrator at `/admin/settings/storage`. There is no environment-variable path: the provider, bucket, region, endpoint and access key id live in the `storage` system settings namespace, and the secret access key in the encrypted credential store (purpose `storage`, encrypted with `SECRETS_ENCRYPTION_KEY`). A deployment with nothing configured answers `503` on uploads, avatar uploads and downloads until an administrator saves a configuration.

You need `storage_config:read` to view the page and `storage_config:write` to change it (Admin only). The slice's design and the three drivers (AWS S3, Cloudflare R2, S3-compatible such as MinIO) are documented in the platform package: `@marinoscar/platform-api/storage`.

## 1. First setup

1. Create a bucket and a key pair that can `PutObject`, `GetObject`, `DeleteObject` and list the bucket. Allow CORS for the application origin (uploads go browser to bucket with presigned URLs).
2. Sign in as an administrator and open `/admin/settings/storage`.
3. Pick the provider, enter bucket, region (endpoint for MinIO and other S3-compatible servers), access key id and secret access key.
4. **Test connection** (four checks: credential, bucket, write/read/delete round trip, presigned URL), then **Save**.
5. The Doctor's `storage.config` and `storage.bucket` checks should pass.

The secret is write-only: the page never shows it again; leaving the field blank on a later save keeps the stored one.

## 2. Upgrading a deployment that used the old environment variables

Before #50 the API read `STORAGE_PROVIDER`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `STORAGE_PART_SIZE`. Carry them over **once**, as a deploy step, with the new image running and `.env` still holding the old variables:

```bash
# inside the api container (the same image the API runs)
docker compose exec api npm run storage:import-env -- --dry-run   # print what would be written
docker compose exec api npm run storage:import-env                # write it
```

- It writes through the same service as the admin page (settings plus the credential store) and prints the driver, bucket, region, endpoint, the last four characters of the access key id and `secret access key: set`. It never prints the secret.
- An `S3_ENDPOINT` maps to the `s3compatible` driver (the old provider used path-style addressing there); without it, the `s3` driver.
- It **refuses** (exit 1) when a runtime configuration already exists (a bucket on any driver or a stored secret). Change that at `/admin/settings/storage` instead.
- `--user <email>` names the administrator the audit row records; the default is `INITIAL_ADMIN_EMAIL`, else the oldest `admin`.
- `STORAGE_PART_SIZE` has no runtime setting; the part size is 10 MiB. A different old value is reported and ignored.
- Exit codes: 0 written (or dry run), 1 refused or nothing to import, 2 failure.

Then verify: `/admin/settings/storage` shows the bucket and "secret stored", **Test connection** passes, an existing object downloads, a new upload lands under `uploads/` (a profile image under `avatars/`), and the Doctor's storage checks pass. **Only then** delete the seven variables from `.env`, keeping a copy until the release is verified: the command never removes them, and the previous build needs them for a rollback. The runtime rows are inert for the old build.

`MAX_FILE_SIZE`, `ALLOWED_MIME_TYPES` and `SIGNED_URL_EXPIRY` stay in the environment: they bound uploads and signed URLs, they do not name a store.

## 3. Object keys

Existing objects keep the `storage_key` stored on their row; nothing is moved. New keys are `uploads/<orgId>/<timestamp>/<uuid><ext>`. Registered prefixes (purge order): `uploads/`, `avatars/`, `node-outputs/`, `storage-config-test/`, then ShellKeep's `session-logs/` (terminal session transcripts) and `runbook-artifacts/` (runbook logs and files), both organization scoped (`app-registrations/storage-prefixes.ts`).

## 4. Rotating a key, switching providers

Rotate by saving the page with a new secret (no restart). Pointing a deployment that already holds objects at a different bucket is refused until the typed `SWITCH` confirmation is sent; it acknowledges, it does **not** copy objects. Use the provider migration (`/api/admin/storage/migrations`, copy-only; the source is never deleted) to move bytes.

## 5. Troubleshooting

| Symptom | Cause |
|---|---|
| Uploads answer `503` | Nothing configured, or the secret is missing: open the page, the Doctor names what is missing |
| `storage:import-env` exits 1 "refused" | A runtime configuration exists; edit it in the UI |
| `storage:import-env` exits 2 "no administrator" | Nobody has signed in yet; sign in once as `INITIAL_ADMIN_EMAIL` or pass `--user` |
| Browser upload fails, test connection passes | The bucket's CORS does not allow the application origin |
