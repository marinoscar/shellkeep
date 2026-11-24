# Runbook: Manage outbound webhooks

> **Audience:** operators and members · **API:** `/api/webhooks` (own), `/api/org/webhooks` (organization), `/api/admin/webhooks` (deployment) · **Permission:** `webhooks:write`, `org_webhooks:write` or `system_webhooks:write`, by scope · **Added by:** #54

Use this when you connect ShellKeep to another system (a chat, a ticketing tool, an automation) with a signed HTTP callback: register an endpoint, check that the receiver verifies the signature, rotate the secret, read the delivery log, redeliver a failure, recover an endpoint the platform switched off, or allow a receiver on a private network. Each scope has its own routes and permission; the steps are the same. The admin pages arrive with the web change of #54; until then use the API (the OpenAPI reference at `/api/docs` lists every route, tag `Webhooks`).

## 1. Events ShellKeep raises

| Event key | When | Payload (ids, names and times only) |
|---|---|---|
| `terminal.session.created` | A terminal session was created | `sessionId`, `serverProfileId`, `serverProfileName`, `createdAt` |
| `terminal.session.terminated` | A session ended: `reason` is `user` (you terminated it), `batch` (you terminated several) or `reaped` (the idle reaper closed it) | `sessionId`, `serverProfileId`, `reason`, `terminatedAt` |
| `server_profile.host_key_changed` | The trusted SSH host key of a profile was replaced by a different one | `serverProfileId`, `previousFingerprint`, `presentedFingerprint`, `detectedAt` |
| `alerts.alert.fired`, `alerts.alert.resolved` | An alert rule started or stopped firing (deployment endpoints only) | the rule, labels, value and summary |

These events belong to the member who owns the session or the profile: they reach that member's **own** endpoints (scope `user`) and nobody else's, not an organization's or the deployment's endpoint. The endpoint's owner must hold `sessions:read` (sessions) or `servers:read` (host key), which every role holds. A payload never carries terminal input or output, a hostname, a username, a credential or a key: a server is named by its profile name and a host key by its public fingerprint. Event keys are permanent; subscribe to one key, to `terminal.*` or to `*`.

## 2. Before you start

- Pick the scope. A member's `user` endpoint receives that member's own events and forwarded notifications; an `org` endpoint (an `org_admin`) receives organization events; a `system` endpoint (an `admin`) receives deployment events such as the alerts.
- The receiver needs a public `https` URL (port 80, 443, 8443 or 1024 and above) that answers `2xx` within 10 seconds. A URL that resolves to a private, loopback or link-local address is refused ([§8](#8-allow-a-receiver-on-a-private-network)). Use `hooks.example.test` style names in notes; never paste a real receiver URL into an issue.
- The receiver must verify the signature over the **raw** request body and deduplicate on the `webhook-id` header.
- To forward notifications (a `user` endpoint), also switch the **Webhooks** column on for the events you want in `/settings/notifications`. ShellKeep's own notification events do not opt in to the `webhook` channel.

## 3. Register an endpoint

1. Create it: `POST /api/webhooks` with `{ "name": "...", "url": "https://hooks.example.test/shellkeep", "eventKeys": ["terminal.session.created", "terminal.session.terminated"], "enabled": true }` (the `org` and `system` scopes use their own route).
2. The response carries the signing secret (`whsec_...`) **once**. Copy it into the receiver's configuration. It is never shown again; only a rotation issues a new one.
3. `POST /api/webhooks/<id>/test` queues a `webhooks.ping` delivery. Read `GET /api/webhooks/<id>/deliveries` and expect `succeeded` with the receiver's status.

Expect `422 WEBHOOK_URL_FORBIDDEN` for a non-public target, `WEBHOOK_EVENT_NOT_PERMITTED` for an event your permissions do not allow and `WEBHOOK_LIMIT_REACHED` past 20 endpoints per member, 50 per organization or 50 per deployment.

## 4. Verify signatures at the receiver

1. Read the raw body bytes before any JSON parsing.
2. Call `verifyWebhookSignature({ secrets, id, timestamp, body, signatureHeader })` from `@marinoscar/platform-contract/webhooks` with the `webhook-id`, `webhook-timestamp` and `webhook-signature` headers. It accepts a timestamp within 300 seconds and any of the secrets.
3. Answer `400` when it returns `false`; otherwise skip an id you have seen, handle the event and answer `2xx`.

By hand: the signature is `base64(HMAC-SHA256(secret bytes, "<webhook-id>.<webhook-timestamp>.<body>"))`, the secret bytes being the base64 part after `whsec_`. Each delivery is `{ id, type, occurredAt, org, data }`.

## 5. Rotate a secret

1. `POST /api/webhooks/<id>/rotate-secret`; copy the new secret from the response. It states when the previous secret stops signing (24 hours by default).
2. Until then every delivery carries two signatures, so a receiver holding either secret verifies. Pass both to `verifyWebhookSignature` while you switch; the old one expires on its own.

## 6. Read the delivery log and redeliver

`GET /api/webhooks/<id>/deliveries` lists deliveries (filter by status or event); one delivery shows the exact body sent, the attempt count, the receiver's status, the first 1 KiB of its answer and an error code.

- `pending` and `delivering` are in flight; `failed` will retry (30 s, 2 m, 10 m, 30 m, 1 h, 2 h, 4 h, 6 h, 6 h); `dead` is final; `succeeded` is done. Error codes: `http_4xx`, `http_5xx`, `timeout`, `network`, `ssrf_blocked`, `http_410`, `secret_missing`.
- After fixing the receiver, `POST /api/webhooks/<id>/deliveries/<deliveryId>/redeliver` resets and queues the same delivery with the same `webhook-id`, so a receiver that deduplicates sees a repeat. It is refused (409) while the endpoint is disabled.
- Deliveries are kept 30 days. Delivery is a `webhooks.deliver` job on the queue, so Admin > Jobs shows it.

## 7. Recover a disabled endpoint

The platform switches an endpoint off and tells its owner (email and bell). `disabledReason` says why:

| Reason | Cause | Fix |
|---|---|---|
| `circuit_open` | 20 failed attempts in a row | Fix the receiver, then enable the endpoint (enabling resets the failure count) |
| `gone` | The receiver answered `410 Gone` | Delete the endpoint, or point it at a live URL and enable it |
| `owner_lost_access` | The owner no longer holds the permission the event needs | Restore the access or recreate the endpoint under an account that has it |

After enabling, `POST .../test` and expect `succeeded`.

## 8. Allow a receiver on a private network

**The SSRF guard stays on.** By default every address a target resolves to must be public unicast (checked at create and again at every send, with the connection pinned to the checked address, and redirects never followed). That is the defence against using the server to reach internal services, including the SSH hosts ShellKeep manages.

A deployment whose receiver is internal needs an explicit option, set **in code** in `apps/api/src/platform/webhooks/webhooks.config.ts` (there is no environment variable and no setting):

1. Preferred: `allowedHosts: ['hooks.internal.example.test']` exempts exactly that host name from the address check.
2. Broad: `allowPrivateTargets: true` accepts any private, loopback or link-local target and ports below 1024. Use it only where no untrusted member can create an endpoint.
3. `allowInsecureHttp: true` additionally accepts `http:`; development only.

Rebuild and restart the API, then create the endpoint and test it. A local check in development (a receiver on `127.0.0.1`) needs `allowPrivateTargets` and `allowInsecureHttp`, and must not be committed.

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Create answers `422 WEBHOOK_URL_FORBIDDEN` | `http`, userinfo, a port below 1024, or a non-public address | A public `https` URL, or [§8](#8-allow-a-receiver-on-a-private-network) |
| Deliveries are `dead` with `ssrf_blocked` | The name resolves to a non-public address at send time | Fix the DNS record, or use `allowedHosts` |
| The receiver rejects every signature | It re-serialized the body, used the wrong secret, or its clock is off by more than 5 minutes | Verify the raw body; use the current secret; fix the clock |
| Deliveries stay `pending` | The job queue is not running | Check Jobs (`webhooks.deliver`) and the Doctor |
| No delivery for a session event | The endpoint is not yours (the event goes to the session owner's own endpoints), does not subscribe to the key, or is disabled | Check the owner, `eventKeys` and `enabled` |
| Every attempt is `timeout` | The receiver takes more than 10 s | Acknowledge with `2xx` first and process after |

## 10. Summary checklist

- [ ] Scope and permission chosen; receiver URL is public `https`
- [ ] Endpoint created, secret copied and stored at the receiver
- [ ] Test delivery `succeeded`; the receiver verifies the raw body and deduplicates on `webhook-id`
- [ ] Rotation: new secret copied, both accepted during the overlap
- [ ] A disabled endpoint's reason read, the cause fixed, the endpoint enabled and tested
- [ ] Private receiver: `allowedHosts` set in code and the API redeployed

## See also

- [Alerts runbook](alerts.md), [local exceptions](../platform-adoption/local-exceptions.md#webhooks-and-alerts-54)
