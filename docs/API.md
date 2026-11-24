# API Reference

## Base URL

- **Development**: http://localhost:8323/api
- **Production**: https://yourdomain.com/api

## Authentication

All endpoints require JWT Bearer token authentication unless explicitly marked as **Public**.

**Authorization Header:**
```
Authorization: Bearer <access_token>
```

Access tokens are short-lived (15 minutes by default). Use the refresh token flow to obtain new access tokens.

## Response Format

### Success Response

```json
{
  "data": <response_data>,
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Response

```json
{
  "statusCode": 400,
  "message": "Human readable error message",
  "error": "BadRequest"
}
```

For validation errors:
```json
{
  "statusCode": 400,
  "message": ["Field validation error 1", "Field validation error 2"],
  "error": "BadRequest"
}
```

## Pagination

Endpoints returning lists support pagination with the following query parameters:

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `page` | number | 1 | - | Page number (1-indexed) |
| `pageSize` | number | 20 | 100 | Items per page |

**Paginated Response Format:**
```json
{
  "data": [...],
  "meta": {
    "total": 150,
    "page": 1,
    "pageSize": 20,
    "totalPages": 8
  }
}
```

---

## Terminal WebSocket

`WS /api/terminal/ws`. The client's first message authenticates it; the token is never read from the URL.

| Direction | Message | Meaning |
|---|---|---|
| client | `{ "type": "auth", "token": "<access token>" }` | Authenticate (within 5 seconds of connecting), or, on an authenticated socket, replace the token with a fresh one |
| server | `{ "type": "auth_ok" }` | Authenticated |
| server | `{ "type": "auth_refreshed" }` | The replacement token was accepted; the socket stays open |
| server | `{ "type": "auth_fail", "reason": "forbidden" }` then close | The caller lacks `sessions:write` (a Viewer), or tried to re-authenticate as another user or organization |
| server | `{ "type": "auth_fail", "reason": "Invalid token" \| "Invalid user" \| "Authentication timeout" }` then close | Bad, expired or revoked token; inactive user; no `auth` in time |
| server | `{ "type": "auth_expired" }` then close | The access token expired and no fresh `auth` arrived; the client refreshes its token and reconnects |
| client | `{ "type": "connect", "sessionId": "<uuid>" }` | Attach to a session the caller owns in the current organization |
| server | `{ "type": "session_error", "code": "NOT_FOUND" }` | Not a UUID, not the caller's, or in another organization (never says which) |
| server | `{ "type": "session_error", "code": "HOST_KEY_UNKNOWN" \| "HOST_KEY_MISMATCH", "error": "<message>", "presented": { "fingerprint", "algorithm" }, "expected": "<fingerprint>" \| null, "serverProfileId": "<uuid>" }` | The SSH host key was refused **before any credential was sent** (#60). `UNKNOWN`: the profile trusts no key yet (`expected` is null); the user verifies `presented` and trusts it, then the client sends `connect` again. `MISMATCH`: the server shows another key than the trusted `expected`; never retried automatically |

Binary frames are terminal input and output; `resize` and `ping` are unchanged. Each denial is logged as `ws.auth.denied` with the user id and the reason, never the token.

## Terminal command assist

`POST /api/ai/terminal/assist` (`ai:use` in the route declaration plus `sessions:write` checked in the handler, behind the AI kill switch and the organization AI switch). Body `{ "sessionId": "<uuid>", "prompt": "<1..2000 chars>", "includeScreen": true }`. The answer is `text/event-stream`:

| Event | Data | Meaning |
|---|---|---|
| `context` | `{ os, shell, cwd, screenLines, findings }` | What was sent: the server facts, the working directory and how many redacted screen lines (0 when `includeScreen` is false or the server profile does not share output) |
| `delta` | `{ text }` | The raw token stream (`COMMAND: ...` then `WHY: ...`) |
| `result` | `{ command, explanation, risk, destructive, reasons }` | The command, parsed server-side as one plain line. `risk` (`low`, `medium`, `high`), `destructive` and `reasons` come from `classifyCommand`, never from the model |
| `error` | `{ code }` | In-band failure after streaming began: `AI_ASSIST_UNPARSEABLE` or an `AiError` code |

A failure before the first event is an ordinary JSON error: `404` for a session that is not the caller's, `403 AI_DISABLED`, `409 AI_CONSENT_REQUIRED`, `429 AI_RATE_LIMITED` with `Retry-After`, and `400 AI_INVALID_REQUEST` when the user has no default model. The command is a suggestion only: nothing on the server or in the web client runs it.

## Terminal session summaries

Summarizing up to 50,000 lines of scrollback outlives a request, so it is a background job (`ai.session.summarize`, server-only). Three routes, all behind the AI kill switch and the organization AI switch, `ai:use` in the declaration plus `sessions:read` checked in the handler:

| Route | Answer |
|---|---|
| `POST /api/ai/terminal/sessions/:id/summaries` | `202 { summaryId, jobId, status: "pending" }`. While a summary of the session is pending, another POST answers with that one. |
| `GET /api/ai/terminal/sessions/:id/summaries` | The newest 20 summaries, newest first. |
| `GET /api/ai/terminal/sessions/:id/summaries/:summaryId` | One summary. `status` is `pending`, `succeeded` or `failed`; poll it (the web client does every 3 s). |

A summary is `{ id, sessionId, jobId, status, summaryMd, commands: [{ command, outcome? }], findings: [{ kind, count }], sourceChars, truncated, model, errorCode, createdAt, completedAt }`; `summaryMd` is Markdown and must be rendered without HTML. `errorCode` on a failed summary is an `AiError` code or one of `AI_CONSENT_REQUIRED`, `AI_OUTPUT_SHARING_DISABLED`, `SESSION_TERMINATED`, `SESSION_NOT_FOUND`, `SESSION_EMPTY`, `SUMMARY_FAILED`, `SUMMARY_TIMED_OUT`. Failures before queuing are ordinary JSON errors: `404` for a session that is not the caller's, `400 SESSION_TERMINATED`, `409 AI_CONSENT_REQUIRED`, `409 AI_OUTPUT_SHARING_DISABLED`, `403` without `sessions:read`.

## Terminal explain

`POST /api/ai/terminal/explain` explains terminal output and suggests one fix (`ai:use` in the route declaration plus `sessions:read` checked in the handler, behind the AI kill switch and the organization AI switch). Body, a union on `mode`: `{ "mode": "selection", "sessionId": "<uuid>", "selection": "<1..16384 chars>" }` or `{ "mode": "last_error", "sessionId": "<uuid>" }`. A selection is client text and is redacted on the server exactly like captured text; `last_error` captures the last 200 lines. The answer is `text/event-stream`:

| Event | Data | Meaning |
|---|---|---|
| `context` | `{ findings, lines, truncated }` | What was sent: the redaction findings (kind and count), the number of lines and whether older text was cut |
| `delta` | `{ text }` | The raw markdown token stream |
| `result` | `{ markdown, suggestedCommand? }` | The sections `## What happened`, `## Likely cause`, `## Suggested fix`. `suggestedCommand` is `{ command, risk, destructive, reasons }`, parsed from a final `COMMAND:` line (one plain line, no control character) and classified by `classifyCommand`, never by the model |
| `error` | `{ code }` | In-band failure after streaming began: `AI_EXPLAIN_EMPTY` or an `AiError` code |

A failure before the first event is an ordinary JSON error: `404` for a session that is not the caller's, `403 AI_DISABLED`, `409 AI_CONSENT_REQUIRED`, `409 AI_OUTPUT_SHARING_DISABLED` (the server profile never shares output), `429 AI_RATE_LIMITED` with `Retry-After`.

`POST /api/ai/terminal/explain/preview` takes the same body and the same checks and returns `{ "data": { "text", "findings", "truncated" } }`: the exact redacted text an explain call would send. It makes no model call. The suggestion is text only: nothing runs it.

## Endpoints

### Authentication

Since #47 these routes (and `/users`, `/allowlist`, `/roles`, `/pat`) are served by the platform identity slice (`@marinoscar/platform-api/identity`); the per-endpoint reference is the OpenAPI document at `/api/docs`, which wins over the examples below where they differ.

#### GET /auth/providers
**Public endpoint** - List enabled OAuth providers.

**Response:**
```json
{
  "data": {
    "providers": [
      {
        "name": "google",
        "enabled": true
      }
    ]
  }
}
```

---

#### GET /auth/google
**Public endpoint** - Initiate Google OAuth flow. Redirects to Google consent screen.

**Response:** HTTP 302 redirect to Google

---

#### GET /auth/google/callback
**Public endpoint** - OAuth callback handler (called by Google).

**Query Parameters:**
- `code` (string) - Authorization code from Google
- `state` (string, optional) - CSRF protection state

**Response:** HTTP 302 redirect to frontend with access token in query parameter
- Sets HttpOnly refresh token cookie
- Redirects to `/auth/callback?accessToken=<token>`

**Error Cases:**
- Email not in allowlist → Redirects to `/auth/error?error=not_authorized`
- OAuth failure → Redirects to `/auth/error?error=oauth_failed`

---

#### GET /auth/me
**Requires Authentication** - Get current user profile.

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "isActive": true,
  "roles": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "Administrator with full access"
    }
  ],
  "permissions": ["users:read", "users:write", "system_settings:read", ...]
}
```

---

#### POST /auth/refresh
**Public endpoint** - Refresh access token using refresh token cookie.

**Request:** No body required (uses HttpOnly cookie)

**Response:**
```json
{
  "accessToken": "new_jwt_access_token",
  "expiresIn": 900
}
```

Sets new refresh token in HttpOnly cookie (token rotation).

**Error Cases:**
- 401 Unauthorized - Missing or invalid refresh token
- 403 Forbidden - User is disabled

---

#### POST /auth/logout
**Requires Authentication** - Logout and revoke refresh token.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes refresh token in database

---

#### POST /auth/logout-all
**Requires Authentication** - Logout from all devices and revoke all refresh tokens.

**Request:** No body required

**Response:** HTTP 204 No Content
- Clears refresh token cookie
- Revokes ALL refresh tokens for the current user across all devices

**Use Case:** Security feature to force re-authentication on all sessions (e.g., after password change or suspected compromise).

---

### Device Authorization (RFC 8628)

The Device Authorization Flow enables input-constrained devices (CLI tools, IoT devices, Smart TVs) to obtain user authorization. See [DEVICE-AUTH.md](DEVICE-AUTH.md) for comprehensive guide and integration examples.

#### POST /auth/device/code
**Public endpoint** - Generate device code pair to initiate device authorization flow.

**Request Body:**
```json
{
  "clientInfo": {
    "name": "My CLI Tool",
    "version": "1.0.0",
    "platform": "linux"
  }
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clientInfo` | object | No | Optional metadata about client device |
| `clientInfo.name` | string | No | Application name |
| `clientInfo.version` | string | No | Application version |
| `clientInfo.platform` | string | No | Platform identifier |

**Response:**
```json
{
  "data": {
    "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4",
    "userCode": "ABCD-1234",
    "verificationUri": "http://localhost:8323/device",
    "verificationUriComplete": "http://localhost:8323/device?code=ABCD-1234",
    "expiresIn": 900,
    "interval": 5
  }
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `deviceCode` | string | Opaque code for device polling (keep secret) |
| `userCode` | string | Human-readable code for user entry (XXXX-XXXX format) |
| `verificationUri` | string | URL where user should authorize |
| `verificationUriComplete` | string | URL with user code pre-filled |
| `expiresIn` | number | Code lifetime in seconds (default: 900) |
| `interval` | number | Minimum polling interval in seconds (default: 5) |

---

#### POST /auth/device/token
**Public endpoint** - Poll for authorization status and obtain tokens when approved.

**Request Body:**
```json
{
  "deviceCode": "a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4"
}
```

**Response (200 OK - Authorized):**
```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

**Error Responses (400 Bad Request):**

While authorization is pending:
```json
{
  "error": "authorization_pending",
  "error_description": "User has not yet authorized this device"
}
```

Device polling too frequently:
```json
{
  "error": "slow_down",
  "error_description": "Polling too frequently. Please slow down."
}
```

Code has expired:
```json
{
  "error": "expired_token",
  "error_description": "The device code has expired"
}
```

User denied authorization:
```json
{
  "error": "access_denied",
  "error_description": "User denied the authorization request"
}
```

**Error Response (401 Unauthorized):**

Invalid device code:
```json
{
  "error": "invalid_grant",
  "error_description": "Invalid device code"
}
```

**Usage:**
1. Device requests code from `/auth/device/code`
2. Device displays `userCode` and `verificationUri` to user
3. Device polls this endpoint every `interval` seconds
4. User visits verification page and approves device
5. Polling returns tokens when approved

---

#### GET /auth/device/activate
**Requires Authentication** - Get activation page information and validate user code.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | No | User verification code to validate |

**Request (No Code):**
```http
GET /auth/device/activate
Authorization: Bearer <token>
```

**Response (No Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:8323/device"
  }
}
```

**Request (With Code):**
```http
GET /auth/device/activate?code=ABCD-1234
Authorization: Bearer <token>
```

**Response (With Valid Code):**
```json
{
  "data": {
    "verificationUri": "http://localhost:8323/device",
    "userCode": "ABCD-1234",
    "clientInfo": {
      "name": "My CLI Tool",
      "version": "1.0.0",
      "platform": "linux"
    },
    "expiresAt": "2024-01-01T12:15:00.000Z"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### POST /auth/device/authorize
**Requires Authentication** - Approve or deny device authorization request.

**Request Body:**
```json
{
  "userCode": "ABCD-1234",
  "approve": true
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userCode` | string | Yes | User code from the device |
| `approve` | boolean | Yes | true to approve, false to deny |

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device authorized successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Invalid user code
- 400 Bad Request - Code has expired or already been processed

---

#### GET /auth/device/sessions
**Requires Authentication** - List current user's approved device sessions.

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | number | No | 1 | Page number |
| `limit` | number | No | 10 | Items per page |

**Response:**
```json
{
  "data": {
    "sessions": [
      {
        "id": "uuid-1234",
        "userCode": "ABCD-1234",
        "status": "approved",
        "clientInfo": {
          "name": "My CLI Tool",
          "version": "1.0.0",
          "platform": "linux"
        },
        "createdAt": "2024-01-01T12:00:00.000Z",
        "expiresAt": "2024-01-01T12:15:00.000Z"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 10
  }
}
```

**Use Case:** View all devices that have been authorized to access the account.

---

#### DELETE /auth/device/sessions/:id
**Requires Authentication** - Revoke a specific device session.

**Parameters:**
- `id` (UUID) - Session ID to revoke

**Response:**
```json
{
  "data": {
    "success": true,
    "message": "Device session revoked successfully"
  }
}
```

**Error Cases:**
- 404 Not Found - Session not found or doesn't belong to current user

**Use Case:** Revoke access for lost or compromised devices.

---

### Test Authentication (Development/Test Only)

**Security Notice:** These endpoints are completely disabled in production. They exist solely to enable automated E2E testing without requiring real OAuth credentials.

#### POST /auth/test/login
**Development/Test Only** - Authenticate as a test user without OAuth.

**Availability:** Only when `NODE_ENV !== 'production'`

**Request Body:**
```json
{
  "email": "test@test.local",
  "role": "admin",
  "displayName": "Test Admin"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Email address for test user |
| `role` | enum | No | Role to assign: `admin`, `contributor`, `viewer` (default: `viewer`) |
| `displayName` | string | No | Display name for the user |

**Response:** HTTP 302 redirect to `/auth/callback?token=<accessToken>&expiresIn=900`
- Sets HttpOnly refresh token cookie (same as OAuth flow)
- Creates user if not exists, assigns specified role

**Error Cases:**
- 403 Forbidden - Endpoint disabled (production environment)
- 400 Bad Request - Invalid email or role

**Use Case:** Playwright E2E tests use this endpoint to authenticate without Google OAuth.

---

### Users

**All user endpoints require Admin role (`users:read` or `users:write` permissions)**

#### GET /users
List all users with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email or display name |
| `isActive` | boolean | - | Filter by active status |
| `role` | string | - | Filter by role name |
| `sortBy` | enum | `createdAt` | Sort field: `email`, `createdAt`, `updatedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "displayName": "John Doe",
      "profileImageUrl": "https://...",
      "providerDisplayName": "John Doe",
      "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
      "isActive": true,
      "createdAt": "2024-01-01T00:00:00.000Z",
      "roles": [
        {
          "id": "uuid",
          "name": "contributor"
        }
      ]
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available from OAuth provider.

---

#### GET /users/:id
Get user by ID.

**Parameters:**
- `id` (UUID) - User ID

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "profileImageUrl": "https://...",
  "providerDisplayName": "John Doe",
  "providerProfileImageUrl": "https://lh3.googleusercontent.com/...",
  "isActive": true,
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "roles": [
    {
      "id": "uuid",
      "name": "contributor",
      "description": "Standard user capabilities"
    }
  ],
  "identities": [
    {
      "provider": "google",
      "providerEmail": "user@example.com"
    }
  ]
}
```

**Note:** `providerDisplayName` and `providerProfileImageUrl` may be null if not available from OAuth provider.

**Error Cases:**
- 404 Not Found - User not found

---

#### PATCH /users/:id
Update user properties (activation status, display name).

**Requires:** `users:write` permission

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "isActive": false,
  "displayName": "New Name"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `isActive` | boolean | No | Activate or deactivate user |
| `displayName` | string | No | Update user's display name |

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "New Name",
  "isActive": false,
  "roles": [
    {
      "id": "uuid",
      "name": "viewer"
    }
  ]
}
```

**Error Cases:**
- 404 Not Found - User not found

---

#### PUT /users/:id/roles
Update user roles (replaces all current roles).

**Requires:** `rbac:manage` permission

**Parameters:**
- `id` (UUID) - User ID

**Request Body:**
```json
{
  "roleNames": ["admin", "contributor"]
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `roleNames` | string[] | Yes | Array of role names to assign (min: 1) |

**Response:**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "John Doe",
  "isActive": true,
  "roles": [
    {
      "id": "uuid",
      "name": "admin",
      "description": "Administrator with full access"
    },
    {
      "id": "uuid",
      "name": "contributor",
      "description": "Standard user capabilities"
    }
  ]
}
```

**Validation Rules:**
- Cannot remove own admin role (prevents accidental lockout)
- At least one role must be assigned
- Role names must exist in the system

**Error Cases:**
- 400 Bad Request - Invalid role names, empty array, or attempting to remove own admin role
- 401 Unauthorized - Not authenticated
- 403 Forbidden - Missing `rbac:manage` permission
- 404 Not Found - User not found

---

### Allowlist

**All allowlist endpoints require Admin role (`allowlist:read` or `allowlist:write` permissions)**

The allowlist restricts application access to pre-authorized email addresses. Users must have their email in the allowlist before they can complete OAuth login.

#### GET /allowlist
List allowlisted emails with pagination, filtering, and sorting.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by email |
| `status` | enum | `all` | Filter by status: `all`, `pending`, `claimed` |
| `sortBy` | enum | `addedAt` | Sort by: `email`, `addedAt`, `claimedAt` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "addedBy": {
        "id": "uuid",
        "email": "admin@example.com"
      },
      "addedAt": "2024-01-01T00:00:00.000Z",
      "claimedBy": {
        "id": "uuid",
        "email": "user@example.com",
        "displayName": "John Doe"
      },
      "claimedAt": "2024-01-02T00:00:00.000Z",
      "notes": "New team member"
    },
    {
      "id": "uuid",
      "email": "pending@example.com",
      "addedBy": {
        "id": "uuid",
        "email": "admin@example.com"
      },
      "addedAt": "2024-01-03T00:00:00.000Z",
      "claimedBy": null,
      "claimedAt": null,
      "notes": null
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "pageSize": 20,
    "totalPages": 5
  }
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`). `claimedBy` object contains `id`, `email`, and `displayName` when not null.

**Status Filters:**
- `all` - All allowlist entries
- `pending` - Emails not yet claimed by a user (claimedBy is null)
- `claimed` - Emails claimed by registered users (claimedBy is not null)

---

#### POST /allowlist
Add email to allowlist.

**Requires:** `allowlist:write` permission

**Request Body:**
```json
{
  "email": "newuser@example.com",
  "notes": "Marketing team member - starts next week"
}
```

**Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | Valid email address (case-insensitive) |
| `notes` | string | No | Optional notes about this user |

**Response:**
```json
{
  "id": "uuid",
  "email": "newuser@example.com",
  "addedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "addedAt": "2024-01-01T00:00:00.000Z",
  "claimedBy": null,
  "claimedAt": null,
  "notes": "Marketing team member - starts next week"
}
```

**Note:** `addedBy` object contains only `id` and `email` (no `displayName`).

**Error Cases:**
- 409 Conflict - Email already exists in allowlist
- 400 Bad Request - Invalid email format

---

#### DELETE /allowlist/:id
Remove email from allowlist.

**Requires:** `allowlist:write` permission

**Parameters:**
- `id` (UUID) - Allowlist entry ID

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Allowlist entry not found
- 400 Bad Request - Cannot remove entry that has been claimed by a user

**Note:** Entries that have been claimed (user has logged in) cannot be removed. This prevents accidentally removing access for existing users.

---

### Settings

#### GET /user-settings
**Requires Authentication** - Get current user's settings. The settings routes are the platform settings slice's (`@marinoscar/platform-api/settings`, #48).

**Response:**
```json
{
  "theme": "light",
  "profile": {
    "imageSource": "provider",
    "imageObjectId": null,
    "displayName": "John Doe"
  },
  "terminal": {
    "showScrollButtons": true,
    "keyShortcuts": [
      { "id": "11111111-1111-4111-8111-111111111101", "label": "ESC", "keystrokes": [{ "modifiers": [], "key": "Escape" }] }
    ]
  },
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `theme` | enum | UI theme: `light`, `dark`, `system` |
| `profile.displayName` | string | User's display name override (omitted when unset) |
| `profile.imageSource` | enum | Which picture represents the user: `provider`, `none` or `upload` (`upload` is an avatar object the user uploaded through `/api/user-settings/profile-image`) |
| `profile.imageObjectId` | string \| null | The uploaded picture's object id |
| `profile.timezone` | string | IANA time zone (omitted when unset) |
| `terminal` | object | Optional namespace, present only when stored: `showScrollButtons` (boolean) and `keyShortcuts` (at most 50; each has a UUID `id`, a `label` of 1 to 40 characters and 1 to 3 `keystrokes`, each with a required `modifiers` array and a `key`). **Absent means the client's built-in defaults** (scroll buttons shown, the default shortcut bar). New users are created with the defaults stored |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `version` | number | Version number for optimistic concurrency control |

A row written before #48 may still carry `profile.useProviderImage` and `profile.customImageUrl`: they read as `imageSource` (`none` when `useProviderImage` was `false`, otherwise `provider`) and are dropped from the stored value by the next write.

---

#### PUT /user-settings
**Requires Authentication** - Replace all user settings.

**Request Body:**
```json
{
  "theme": "dark",
  "profile": {
    "displayName": "Jane Doe",
    "imageSource": "none"
  }
}
```

**Response:** the same shape as `GET`.

**Note:** This replaces the entire settings object (a `terminal` namespace left out of the body is removed). Use PATCH for partial updates.

---

#### PATCH /user-settings
**Requires Authentication** - Partially update user settings.

**Request Body:**
```json
{
  "terminal": { "showScrollButtons": false }
}
```

**Request Headers (Optional):**
```
If-Match: 1
```

**Response:** the same shape as `GET`.

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates in concurrent scenarios

**Merge semantics (JSON Merge Patch):**
- `theme` and the `profile` fields in the body replace the stored ones; the others are kept.
- `terminal`: a field in the body replaces the stored field (`keyShortcuts` replaces the whole list); a user without the namespace starts from the defaults; `"terminal": null` removes the namespace.

---

#### GET /system-settings
**Requires:** `system_settings:read` permission (Admin only)

Get system-wide settings.

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {},
  "terminal": {
    "detachAfterMinutes": 60,
    "terminateDetachedAfterHours": 12,
    "purgeTerminatedAfterDays": 3,
    "doctorProbeProfileId": null
  },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "updatedAt": "2024-01-01T00:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 1
}
```

**Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `ui.allowUserThemeOverride` | boolean | Allow users to override system theme |
| `security.jwtAccessTtlMinutes` | number | JWT access token TTL in minutes |
| `security.refreshTtlDays` | number | Refresh token TTL in days |
| `features` | object | Feature flags (extensible) |
| `terminal.detachAfterMinutes` | integer | A session with no client is `detached` after this long (default 60, 5 to 1440) |
| `terminal.terminateDetachedAfterHours` | integer | A `detached` session is terminated after this long (default 12, 1 to 720) |
| `terminal.purgeTerminatedAfterDays` | integer | A `terminated` session row is purged after this long (default 3, 1 to 365) |
| `terminal.doctorProbeProfileId` | string \| null | The server profile the Doctor probes (UUID, or `null`) |
| `updatedAt` | string | ISO 8601 timestamp of last update |
| `updatedBy` | object | User who last updated settings |
| `version` | number | Version number for optimistic concurrency control |

---

#### PUT /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Replace all system settings. `ui`, `features` and `terminal` are each optional in the body: a namespace left out keeps its stored value. `security` is derived from the session policy and is read-only.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {},
  "terminal": {
    "detachAfterMinutes": 60,
    "terminateDetachedAfterHours": 12,
    "purgeTerminatedAfterDays": 3,
    "doctorProbeProfileId": null
  }
}
```

**Response:** the same shape as `GET`:
```json
{
  "ui": {
    "allowUserThemeOverride": true
  },
  "features": {},
  "terminal": { "detachAfterMinutes": 60, "terminateDetachedAfterHours": 12, "purgeTerminatedAfterDays": 3, "doctorProbeProfileId": null },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

---

#### PATCH /system-settings
**Requires:** `system_settings:write` permission (Admin only)

Partially update system settings.

**Request Body:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  }
}
```

**Request Headers (Optional):**
```
If-Match: 1
```

**Response:**
```json
{
  "ui": {
    "allowUserThemeOverride": false
  },
  "features": {},
  "terminal": { "detachAfterMinutes": 60, "terminateDetachedAfterHours": 12, "purgeTerminatedAfterDays": 3, "doctorProbeProfileId": null },
  "security": {
    "jwtAccessTtlMinutes": 15,
    "refreshTtlDays": 14
  },
  "updatedAt": "2024-01-01T12:00:00.000Z",
  "updatedBy": {
    "id": "uuid",
    "email": "admin@example.com"
  },
  "version": 2
}
```

**Optimistic Concurrency Control:**
- Include `If-Match: <version>` header to ensure settings haven't been modified by another request
- Returns **409 Conflict** if version mismatch detected
- Prevents lost updates when multiple admins modify settings concurrently

**Merge semantics:** `ui` merges per field, `features` per flag (a flag is added or replaced, never removed by a PATCH), `terminal` per field (`doctorProbeProfileId: null` clears the probe profile). A value outside the bounds above is a **400**.

---

### Storage Objects

The storage system provides file upload and management capabilities with support for large files (GB scale) through resumable multipart uploads. It is the platform's storage slice since #50; the generated OpenAPI at `/api/docs` is the per-route reference.

- **Provider**: runtime configuration at `/admin/settings/storage` (`/api/admin/storage-config`, `storage_config:read` / `storage_config:write`, Admin only), never environment variables. Until it is configured, the object routes answer `503`. [Runbook](runbooks/storage-configuration.md).
- **Permissions**: reads need `storage:read`, writes `storage:write` (contributor and org_admin; a viewer reads only). `storage:delete_any` (Admin) widens delete.
- **Ownership**: an object another user uploaded in the same organization answers `403`; another organization's object is a `404`.
- **Additional routes of the slice**: `GET /api/storage/status`, `POST /api/storage/objects/:id/upload/part-urls`, `PUT /api/storage/objects/:id/upload/parts/:partNumber` (API-proxied parts, only for a driver without presigned URLs), `/api/admin/storage/migrations` (copy-only provider migration), `GET|POST|DELETE /api/user-settings/profile-image` and the public `GET /api/users/:userId/avatar/:objectId`.
- **Keys**: new objects are `uploads/<orgId>/<timestamp>/<uuid><ext>` (profile images under `avatars/`); existing rows keep their stored key. ShellKeep also registers `session-logs/` and `runbook-artifacts/`.
- **Removed**: the daily 24-hour expiry of every object. Only unfinished uploads are reclaimed.

#### Initialize Resumable Upload

`POST /api/storage/objects/upload/init`

**Requires Authentication** - Initialize a multipart upload for large files. Returns presigned URLs for direct-to-S3 uploads.

**Request Body:**
```json
{
  "name": "document.pdf",
  "size": 104857600,
  "mimeType": "application/pdf"
}
```

**Response:**
```json
{
  "data": {
    "objectId": "uuid",
    "uploadId": "s3-upload-id",
    "partSize": 10485760,
    "totalParts": 10,
    "presignedUrls": [
      { "partNumber": 1, "url": "https://..." },
      { "partNumber": 2, "url": "https://..." }
    ]
  }
}
```

---

#### Get Upload Status

`GET /api/storage/objects/:id/upload/status`

**Requires Authentication** - Check progress of an in-progress upload.

**Response:**
```json
{
  "data": {
    "status": "uploading",
    "uploadedParts": 5,
    "totalParts": 10,
    "progress": 50
  }
}
```

---

#### Complete Upload

`POST /api/storage/objects/:id/upload/complete`

**Requires Authentication** - Finalize multipart upload after all parts are uploaded.

**Request Body:**
```json
{
  "parts": [
    { "partNumber": 1, "eTag": "\"etag1\"" },
    { "partNumber": 2, "eTag": "\"etag2\"" }
  ]
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "processing"
  }
}
```

---

#### Abort Upload

`DELETE /api/storage/objects/:id/upload/abort`

**Requires Authentication** - Cancel an in-progress upload and clean up resources.

**Response:** HTTP 204 No Content

---

#### Simple Upload

`POST /api/storage/objects`

**Requires Authentication** - Direct upload for small files (< 100MB) using multipart/form-data.

**Request:**
- Content-Type: `multipart/form-data`
- Body: File attached as form data with key `file`

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 1048576,
    "mimeType": "application/pdf",
    "status": "uploading"
  }
}
```

---

#### List Objects

`GET /api/storage/objects`

**Requires Authentication** - List storage objects with pagination and filtering.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 20 | Items per page (max 100) |
| `status` | enum | - | Filter by status: `pending`, `uploading`, `processing`, `ready`, `failed` |
| `sortBy` | enum | `createdAt` | Sort field: `createdAt`, `name`, `size` |
| `sortOrder` | enum | `desc` | Sort order: `asc`, `desc` |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "document.pdf",
      "size": 104857600,
      "mimeType": "application/pdf",
      "status": "ready",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "pageSize": 20,
    "totalPages": 3
  }
}
```

---

#### Get Object

`GET /api/storage/objects/:id`

**Requires Authentication** - Get storage object metadata.

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "size": 104857600,
    "mimeType": "application/pdf",
    "status": "ready",
    "metadata": {
      "customField": "value"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

---

#### Get Download URL

`GET /api/storage/objects/:id/download`

**Requires Authentication** - Get a signed download URL for the object.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `expiresIn` | number | 3600 | URL expiration in seconds |

**Response:**
```json
{
  "data": {
    "url": "https://s3.amazonaws.com/...",
    "expiresAt": "2024-01-01T01:00:00.000Z"
  }
}
```

---

#### Delete Object

`DELETE /api/storage/objects/:id`

**Requires Authentication** - Delete a storage object and its associated file.

**Response:** HTTP 204 No Content

**Error Cases:**
- 404 Not Found - Object not found
- 403 Forbidden - User does not own object (non-admin)

---

#### Update Metadata

`PATCH /api/storage/objects/:id/metadata`

**Requires Authentication** - Update custom metadata for an object.

**Request Body:**
```json
{
  "metadata": {
    "customField": "value",
    "tags": ["document", "important"]
  }
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "document.pdf",
    "metadata": {
      "customField": "value",
      "tags": ["document", "important"]
    },
    "updatedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

---

### Server Profiles: the list, tags and health

The Servers page (#79) reads one list route and two tag routes. No list response ever carries a credential field (the `has*` flags go to the credential holder only, see Sharing).

| Route | Permission | Notes |
|---|---|---|
| `GET /api/server-profiles` | `servers:read` | Paginated (`page`, `pageSize` up to 100). Filters, all ANDed: `q` (name, hostname or username; `search` is the older spelling), `tag` (repeatable or comma-separated, every tag must match), `owner` (`me`, `shared`, `group:<uuid>`; `filter=all|mine|shared` still works), `health` (`reachable`, `unreachable`, `unknown`), `hostKey` (`trusted`, `untrusted`, `mismatch`). `sort` is `name`, `hostname`, `health`, `lastSession` or `updatedAt` (default, newest first), `order` `asc`/`desc`. An unknown value is a 400 |
| `GET /api/server-profiles/tags` | `servers:read` | `{ tags: string[] }`: the distinct tags on the profiles the caller may see, sorted |
| `PATCH /api/server-profiles/bulk-tags` | `servers:write` | `{ ids: uuid[] (1..200), add?: string[], remove?: string[] }` (at least one tag; never the same tag in both). Each id needs `write` access; returns `{ updated, unchanged, denied }`, where `denied` holds the ids that do not exist, are not visible or may not be changed (reported, never a failure). Each changed profile is audited as `server_profile.update` with `bulk: true` |

Each item also carries `health`, `hostKeyState`, `lastTestAt`, `lastTestOk` and `lastSessionAt`:

- **Health** is the outcome of the last `POST /server-profiles/:id/test`, stored on the profile (`last_test_at`, `last_test_ok`, `last_test_code`): `reachable` (the test logged in), `unreachable` (it failed), `unknown` (never tested, or stopped by a host-key refusal, which proves neither way). Trusting or forgetting the key after a refusal, or changing the hostname or port, clears it. The health definition is `apps/api/src/server-profiles/server-health.ts`, shared with the dashboard.
- **Host key state**: `untrusted` without a trusted fingerprint, `mismatch` while the last test was refused with `HOST_KEY_MISMATCH`, else `trusted`.
- **Last session** is when the CALLER last used the server (their own sessions only); `sort=lastSession` orders a server never used last. `GET /api/sessions?serverProfileId=<uuid>` lists those sessions.

### Server Profiles: host keys and facts

SSH host keys are verified before any credential is sent (#60). A profile trusts at most one key (`fingerprint`, OpenSSH `SHA256:` format, with its `hostKeyAlgorithm`); the system setting `ssh.hostKeyPolicy` decides what happens to a server whose key is not trusted yet.

| Policy | Key not trusted yet | Key changed |
|---|---|---|
| `tofu_prompt` (default) | refused with `HOST_KEY_UNKNOWN`; the user verifies and trusts it | refused with `HOST_KEY_MISMATCH` |
| `tofu_auto` | trusted on first contact, audited (`server_profile.host_key_auto_trusted`) | refused with `HOST_KEY_MISMATCH` |
| `strict` | refused with `HOST_KEY_UNKNOWN` | refused with `HOST_KEY_MISMATCH` |

A changed key is refused under every policy. Every connection path (terminal, test connection, history download, the Doctor probe, the facts probe) goes through one connection factory, so none can skip the check.

A server profile response carries, besides its connection fields and (to the user who saved the credentials only) `has*` flags, `owner` and `access` (see Sharing below): `fingerprint`, `hostKeyAlgorithm`, `hostKeyTrustedAt` (all null while untrusted), `facts` (null until probed) and `factsProbedAt`. `PATCH` of `hostname` or `port` to a different value clears the trust and the facts.

#### POST /server-profiles/:id/host-key/scan
Permission `servers:read`. Reads the key the server presents and disconnects; **no credential is sent** and nothing is stored.

```json
{ "data": {
  "presented": { "fingerprint": "SHA256:...", "algorithm": "ssh-ed25519" },
  "trusted": { "fingerprint": "SHA256:...", "algorithm": "ssh-ed25519", "trustedAt": "2026-01-01T00:00:00.000Z" },
  "matches": true
} }
```
`trusted` is null when the profile trusts no key. `502 SSH_HOST_UNREACHABLE` when the server cannot be reached.

#### POST /server-profiles/:id/host-key/trust
Permission `servers:write`. Body `{ "fingerprint": "SHA256:...", "confirmHostname"?: "<profile hostname>" }`. Scans again and stores the key only if it equals `fingerprint` (the one the user verified); returns the updated profile and probes the server facts (best effort). Audited as `server_profile.host_key_trusted`.

Replacing a different trusted key also needs `confirmHostname` equal to the profile hostname and is audited as `server_profile.host_key_replaced` with the old and new fingerprints.

| Status | Code | When |
|---|---|---|
| 400 | `HOST_KEY_CONFIRMATION_REQUIRED` | replacing a different key without the matching `confirmHostname` |
| 409 | `HOST_KEY_CHANGED_DURING_TRUST` | the server now presents another key than `fingerprint` |
| 502 | `SSH_HOST_UNREACHABLE` | the server could not be reached |

#### DELETE /server-profiles/:id/host-key
Permission `servers:write`. Forgets the trusted key (`fingerprint`, `hostKeyAlgorithm`, `hostKeyTrustedAt` null; the next connection asks again; the probed `facts` stay). Returns the updated profile. Audited as `server_profile.host_key_forgotten`.

#### POST /server-profiles/:id/test
Permission `servers:read`. `{ "success": true }`, or `{ "success": false, "error": "..." }`. A refused host key adds `"code": "HOST_KEY_UNKNOWN" | "HOST_KEY_MISMATCH"`, `"presented": { "fingerprint", "algorithm" }` and `"expected": "<fingerprint>" | null`. A successful test also refreshes the server facts. The outcome is stored (`lastTestAt`, `lastTestOk`, and the refusal code) and feeds the health column and the dashboard (#79); the log line carries only the profile id and the outcome.

#### POST /server-profiles/:id/facts/refresh
Permission `servers:write`. Probes the server now (one fixed read-only command) and returns `{ "facts": { "kernel", "os", "distroId?", "distroVersion?", "prettyName?", "shell?", "has": [], "packageManager?" }, "factsProbedAt" }`. `409 HOST_KEY_UNKNOWN | HOST_KEY_MISMATCH` (with `details.presented`, `details.expected`, `details.serverProfileId`) when the key is not trusted. `GET /sessions/:id/history` answers the same 409 for a refused key.

---

### Runbooks

Versioned, reusable multi-step procedures (#61). Definitions can hold sensitive commands, so every route requires a runbook permission in the caller's organization: `runbooks:read` for reads and target preview, `runbooks:write` for everything that changes a runbook, validates a definition or touches a secret. (`runbooks:run` and `runbooks:approve` are enforced by the run engine and the approvals inbox, see Runbook runs and approvals below.)

| Route | Permission | Notes |
|-------|------------|-------|
| `GET /api/runbooks` | `runbooks:read` | Paginated (`page`, `pageSize`); filters `q` (name or description), `tag`, `includeArchived`, and `filter` (`all` default, `mine`, `shared`). Lists only the runbooks the caller may see (#71): theirs, their groups' and those shared with them; each item has `owner` and `access`, plus `stepKinds` (the kinds of the latest version's steps, never a command) and `lastRun` (`{ id, status, createdAt, finishedAt }` or `null`; #65) |
| `GET /api/runbooks/:id` | `runbooks:read` | Latest version embedded; `ETag: "v<version>"` |
| `POST /api/runbooks` | `runbooks:write` | `{ name, description?, tags?, definition, changelog? }` creates the runbook and version 1 |
| `PUT /api/runbooks/:id/definition` | `runbooks:write` | `{ definition, changelog? }`; needs `If-Match: "v<n>"` (the ETag of a GET). Creates version n+1 and returns the new `ETag`; a definition identical to the latest (same sha256) is a 200 with `created: false` and no new version |
| `PATCH /api/runbooks/:id` | `runbooks:write` | Metadata only: `name`, `description`, `tags` |
| `DELETE /api/runbooks/:id` | `runbooks:write` | Archives (soft delete), idempotent; 204 |
| `DELETE /api/runbooks/:id/permanent` | `runbooks:write` + `owner` on the runbook | Deletes the runbook with its versions, runs and grants in one transaction; 204. `404` below `owner`, `409 RUNBOOK_HAS_ACTIVE_RUNS` while a run is unfinished. A group that owns a runbook (archived or not) cannot be deleted until this runs |
| `POST /api/runbooks/:id/restore` | `runbooks:write` | Un-archives; 409 `RUNBOOK_NAME_TAKEN` if a live runbook has the name now |
| `GET /api/runbooks/:id/versions` | `runbooks:read` | History, newest first, without definitions |
| `GET /api/runbooks/:id/versions/:version` | `runbooks:read` | One version with its definition and its `risk` (the embedded latest version of `GET /api/runbooks/:id` carries `risk` too) |
| `POST /api/runbooks/validate` | `runbooks:write` | `{ definition }` returns `{ valid, definition (normalised), definitionSha256, warnings, risk }`; nothing is saved. `risk` is the destructive-command assessment, see Runbook safety below |
| `POST /api/runbooks/targets/preview` | `runbooks:read` | `{ selector }` returns `{ servers: [{ id, name, hostname, tags, hostKeyTrusted, facts: { prettyName } }], skipped: [{ serverProfileId, reason }], total, capped, limit }` |

**Versions are immutable.** A definition change appends a version; nothing updates or deletes one. Names are unique among live (non-archived) runbooks of an organization, case-insensitively.

**Definition.** `{ schemaVersion: 1, parameters[], steps[1..50], defaultTargets, strategy }`; step kinds `command`, `script`, `package_update`, `file_upload`, `collect_logs`, `ai_task`, `approval_gate`. The schema is `apps/api/src/runbooks/schema/runbook-definition.schema.ts` (types: `RunbookDefinition`, `RunbookStep`, `RunbookParameter`, `TargetSelector`, `RunStrategy`). Parameters reach commands only as environment variables; there is no template substitution into command text. `allow`, `deny` and parameter `pattern` values are RE2 expressions. A definition that fails answers `422 RUNBOOK_DEFINITION_INVALID` with `details.issues: [{ path, code, message }]`, `path` being the JSON path into the definition.

**Target resolution.** The selector is the union of `serverIds` and the servers whose tags match (`any` = overlap, `all` = contains; both given means both must hold), minus `exclude`. Servers the caller may `connect` to (their own, one owned by a group of theirs, one shared with them as `operator` or better; #71) are targets, sorted by `name, id` and capped at the organization's effective `runbooks.maxTargetsPerRun` (`total` is the count before the cap, `capped` says it was cut). A server NAMED by id that the caller cannot connect to is listed in `skipped` with `reason: "forbidden"`, and a named id that does not exist in the organization with `"not_found"`; a server matched only by TAG is considered only when the caller may read it, so a tag never reveals another user's private server. `groupIds` (groups of servers, not user groups) still answers `422 RUNBOOK_TARGET_GROUPS_UNAVAILABLE`.

**Secret parameters.** `GET /api/runbook-secrets`, `PUT /api/runbook-secrets/:name` (`{ value, label? }`) and `DELETE /api/runbook-secrets/:name` (all `runbooks:write`; `name` matches `^[a-z][a-z0-9_-]{0,63}$`) manage the organization's `runbook_secret` credentials. Values are write-only: responses carry `name`, `label`, `hint` (masked, at most the last four characters), `createdAt`, `updatedAt` and `updatedBy`, never the value. A run names the credential for a `secret` parameter (`secretRefs`); the value never appears in a definition, a run row or a job payload.

**Audit events** (`audit_events`): `runbook.created`, `runbook.version_created` (with `definition_sha256`), `runbook.archived`, `runbook.restored`, `runbook_secret.set`, `runbook_secret.deleted`.

**Settings.** The `runbooks` system namespace (`enabled`, `maxTargetsPerRun` 200, `maxConcurrency` 20, `defaultStepTimeoutSec` 600, `maxLogBytesPerStep` 5 MiB, `approvals.allowSelfApproval` false, `approvals.defaultExpirySec` 86400, `ai.agentEnabled` true) can be tightened, never loosened, per organization through `/api/org-settings`.

### Runbook runs and approvals

The execution engine (#62). A run executes one runbook version on a set of servers as the person who started it; every step of every server is a queue job (`runbook.run.start`, `runbook.target.run`, `runbook.run.advance`, `runbook.logs.compact`; the target job is server-only and runs one segment of steps per server over ONE SSH connection opened through the host-key-verifying factory).

| Route | Permission | Notes |
|-------|------------|-------|
| `POST /api/runbooks/:id/runs` | `runbooks:run` | `{ version?, params, secretRefs?, targets?, strategy?, dryRun?, confirm? }`; `202 { runId, status: 'queued', dryRun, awaitingApproval, approvalId }`; `428 RUNBOOK_CONFIRMATION_REQUIRED` for a destructive runbook (see Runbook safety). Params are checked against the definition (types, required, enum, pattern: `422 RUNBOOK_PARAMS_INVALID` with `details.issues`), each `secretRefs` name must exist (`422 RUNBOOK_SECRET_REF_UNKNOWN`); `503 RUNBOOKS_DISABLED` while `runbooks.enabled` is off |
| `GET /api/runbook-runs` | `runbooks:read` | Paginated; filters `runbookId`, `status`, `trigger`, `initiatedBy` and `since` (`30m`, `24h`, `7d`: queued within that window; #65). Each item carries `targets: { total, succeeded, failed, running }` (`failed` counts cancelled servers too) |
| `GET /api/runbook-runs/:id` | `runbooks:read` | The run (`dryRun`, `destructive`, `errorCode`, `aiStopRequestedAt`), its targets with their step matrix (an AI step also has `aiSummary`), its `approvals` (with `payload` for the AI kinds) and `counts` |
| `GET /api/runbook-runs/:id/targets/:targetId/steps/:stepIndex/log` | `runbooks:read` | `text/plain`, redacted; from storage once the step ended, else from the chunks; `?tail=N` lines |
| `GET /api/runbook-runs/:id/logs/stream` | `runbooks:read` | SSE: `snapshot`, then `chunk` (id `<stepRowId>:<seq>`), `step`, `target`, `run`, `approval` and a `heartbeat` every 15 s. `Last-Event-ID` replays the chunks after it. `.../targets/:targetId/logs/stream` filters to one server. Send `Authorization: Bearer`, so use a fetch-based reader, not `EventSource` |
| `POST /api/runbook-runs/:id/cancel` | `runbooks:run` | `202`; pending targets are cancelled, running ones stop within seconds (INT, then KILL after 10 s) |
| `POST /api/runbook-runs/:id/targets/:targetId/cancel` | `runbooks:run` | One server |
| `POST /api/runbook-runs/:id/retry` | `runbooks:run` | `{ only: 'failed' \| 'all', confirm? }`; a NEW run with the same version, params, secret references and strategy on those servers (a retry of a dry run is a dry run; of a destructive runbook it needs `confirm` and the same approval); only for a finished run |
| `GET /api/runbook-runs/:id/audit` | `runbooks:read` | The audit trail of one run, see Runbook safety |
| `GET /api/runbook-runs/:id/audit/export` | `runbooks:read` | `?format=csv\|json`: the same trail as a streamed download |
| `GET /api/runbook-commands` | `runbooks:read` | Every command runbooks executed, org-wide, see Runbook safety |
| `POST /api/runbook-runs/:id/resume` | `runbooks:run` + `runbooks:approve` | Releases a run paused after its canary batch (an approval decision) |
| `GET /api/runbook-approvals` | `runbooks:read` | The inbox; `status=pending` by default (`approved`, `rejected`, `expired`, `all`). Each item names the run, `targetName` (the server, `null` for a run-scope approval) and `initiatedByName`; `kind` is `step`, `gate`, `destructive_run`, `ai_command` or `ai_plan`, and the two AI kinds carry `payload` (see Runbook AI steps); the page carries `allowSelfApproval` (the organization's effective rule, so the UI can explain a disabled button). `count=true` answers `{ count }` only (the Runbooks badge, #65) |
| `POST /api/runbook-approvals/:id/decision` | `runbooks:approve` | `{ decision: 'approve' \| 'reject', comment? }`. `403 RUNBOOK_SELF_APPROVAL` for the person who started the run unless `runbooks.approvals.allowSelfApproval`; `409 RUNBOOK_APPROVAL_NOT_PENDING` |

**Run statuses:** `queued resolving running paused cancelling succeeded failed partially_failed aborted cancelled`. **Target:** `pending queued running waiting succeeded failed skipped cancelled`. **Step:** `pending running waiting_approval succeeded failed skipped timed_out cancelled`. Every status column has a CHECK constraint; the transitions are `engine/state-machine.ts`.

**Strategy.** `concurrency` targets in flight (a sliding window; capped by `runbooks.maxConcurrency`), or waves of `batchSize` that start only when the whole previous wave is settled. More failed targets than `maxFailures` (`{count}` or `{percent}` of the resolved servers, rounded up; `{count: 0}` is fail-fast) aborts the run: pending targets are cancelled and, with `abortInFlight`, running ones are asked to cancel. `pauseAfterFirstBatch` pauses after the first wave and creates a run-scope approval of kind `gate`. Final status: `succeeded` (all succeeded or skipped), `failed` (none succeeded), `partially_failed`; `aborted` and `cancelled` stay.

**Steps.** `when` (`on_success`, `on_failure`, `always`) is decided from the steps that failed WITHOUT `continueOnError`. A `command` or `script` runs as `bash -s` (`sh -s`, `python3 -`; `sudo -n [-u user] ...` with `runAs.sudo`); the command, the parameters (environment variables) and the secrets travel on stdin, never in argv. `package_update` renders the manager's commands (apt, dnf, yum, apk, zypper, brew; `auto` uses the server facts; `securityOnly` is apt and dnf/yum only, else `UNSUPPORTED_OPTION`). `file_upload` streams the storage object over SFTP to `<destPath>.shellkeep-tmp`, verifies its sha256 on the server, then `chmod`, `chown` and `mv` (`DEST_EXISTS` without `overwrite`). `approval_gate` parks the target `waiting` on a run-scope (one row for the run) or target-scope approval and notifies `runbooks:approve` holders (`runbooks.approval_requested`, after the commit). `ai_task` parks the target `waiting` on the step and queues the server-only `ai.runbook.agent` job (see Runbook AI steps). `collect_logs` stores the collected files as an artifact (see Runbook logs and artifacts).

**Logs and secrets.** Output is redacted before it is stored or published: the shared patterns plus the exact secret values of the run (shown as `[REDACTED:literal]`). It is stored in 4 KiB chunks, capped at `runbooks.maxLogBytesPerStep` (then one `[output truncated]` line), and moved to `runbook-artifacts/<orgId>/<runId>/<targetId>/<stepIndex>.log` when the step ends. A secret value lives in the memory of the target job only: not in a payload, a run row, a log, an event, a span or a command preview.

**Failure codes** (on `error_code` of a target or step): `PERMISSION_REVOKED` (the starter lost `runbooks:run` or the server since the run was queued), `HOST_KEY_UNKNOWN`, `HOST_KEY_MISMATCH`, `SSH_UNREACHABLE`, `SSH_AUTH_FAILED`, `STEP_FAILED`, `STEP_TIMED_OUT`, `SUDO_PASSWORD_REQUIRED`, `PACKAGE_MANAGER_UNKNOWN`, `UNSUPPORTED_OPTION`, `DEST_EXISTS`, `FILE_TOO_LARGE`, `ARTIFACT_TOO_LARGE`, `UPLOAD_CHECKSUM_MISMATCH`, `SECRET_UNAVAILABLE`, `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`, `EXECUTOR_LOST` (the reconcile sweep found a running target, or a running AI step, whose job is gone), `CANCELLED`; the AI step adds its own, listed under Runbook AI steps.

### Runbook logs and artifacts

Log collection, the zip bundle and sharing it (#63). The web page of a run (#65) links these routes; nothing here streams a file: a download is a presigned URL.

**The `collect_logs` step.** `paths` (absolute paths or globs, no control characters), `journalUnits`, `since` (`30m`, `2h`, `7d`), `maxBytesPerFile` (the LAST bytes of a file are kept), `maxTotalBytes`, `failIfEmpty` (default `false`; additive, `schemaVersion` stays 1) and `runAs`. One constant script runs over the step's SSH connection (`engine/steps/collect-logs.step.ts`); the paths, units, caps and window travel as environment variables on stdin (`SK_PATHS`, `SK_UNITS`, `SK_MAX_FILE`, `SK_SINCE`) and are never part of the script text, so a path such as `/var/log/$(reboot)` is a literal file name that matches nothing. The tar.gz arrives on stdout into a platform temp file; past `maxTotalBytes` the step fails `ARTIFACT_TOO_LARGE` and nothing is stored. Every file is then run through `redactText` with the run's secret values and repacked, and only that archive is uploaded to `runbook-artifacts/<orgId>/<runId>/<targetId>/<stepIndex>.tar.gz` and recorded in `runbook_artifacts` (`kind: 'target_archive'`, `sha256`, `file_count`, `size_bytes`). No match is `succeeded` with a `no files matched` line and `file_count` 0 (an empty archive), unless `failIfEmpty`. stderr goes to the step log. The collection command is audited like every command; a dry run never collects.

| Route | Permission | Notes |
|-------|------------|-------|
| `GET /api/runbook-runs/:id/artifacts` | `runbooks:read` | `{ items: [{ id, kind: 'target_archive', runTargetId, runStepId, serverName, stepId, stepIndex, fileCount, sizeBytes, sha256, createdAt }], bundle: { status: 'ready' \| 'building' \| 'none', artifactId, sizeBytes, createdAt } }`; a run the caller may not see is 404 |
| `POST /api/runbook-runs/:id/artifacts/bundle` | `runbooks:read` | `202 { jobId, artifactId }`: queues `runbook.artifacts.bundle` (one in flight per run: a second ask returns the same `jobId`); `{ jobId: null, artifactId }` when the run already has a bundle; `409 RUNBOOK_RUN_STATE` while the run has not finished (or is a dry run). Poll the list until `bundle.status` is `ready` |
| `GET /api/runbook-runs/:id/artifacts/:artifactId/download` | `runbooks:read` | `{ url, expiresAt }`: a presigned URL valid 15 minutes (`Content-Disposition: attachment`); audited `runbook_artifact.downloaded` |

**The bundle.** When a finished run stored at least one archive, the post-commit `RunbookRunFinished` hook queues `runbook.artifacts.bundle` (payload `{ runId, orgId }`, 30 minutes, 3 attempts, deduplicated by run). It streams ONE zip (`archiver`) to a temp file and uploads it to `runbook-artifacts/<orgId>/<runId>/bundle.zip`:

```
<serverName>__<targetId>/<stepId>.tar.gz        each archive, as stored
logs/<serverName>__<targetId>/<stepIndex>.log   each step log
manifest.json                                    { manifestVersion, generatedAt, run: { id, runbook, version, status, startedAt, finishedAt, initiatedBy },
                                                   targets: [{ id, server: { name, hostname }, status, steps: [{ index, id, kind, status, exitCode, durationMs }] }],
                                                   files: [{ path, sha256, bytes }] }
```

`files` lists every entry except `manifest.json` itself with its sha256 and size. The job is idempotent and carries `nodeResultSchema` + `persistNodeResult` (node-eligible, no secret broker: a node would upload to the key the server derives); no CLI executor ships for the type yet, so the server builds every bundle.

**Sharing the bundle by link.** `runbook_run` is the one resource type that may be shared by LINK (a server profile and a runbook still answer `422 ROLE_NOT_GRANTABLE`). Its only role is `viewer`; `user` and `group` grants are not grantable. The person who started the run creates the link with the sharing slice's own route, `POST /api/grants/links` (`sharing:write`; `{ resourceType: 'runbook_run', resourceId: <runId>, role: 'viewer', expiresAt? }`): 7 days by default, capped at 30; anyone else gets 404, and so does a run nobody started (a schedule). The response carries the URL (`<APP_URL>/s#lnk_...`, the token in the fragment) and the token once. Revoke with `DELETE /api/grants/:id`. Audit: `runbook_artifact.link_created` (ids and role, never the token) next to the slice's own `grant:link:create`.

`GET /api/public/runbook-runs/bundle` is **public**: the `X-Link-Token` header is the only credential. It answers `{ runbook, finishedAt, sizeBytes, url, urlExpiresAt }` where `url` is a presigned download URL valid 15 minutes (never the bytes). An unknown, malformed, missing, revoked or expired link, a link of another type and a run with no bundle are ONE `404`; repeated misses from one address become `429 LINK_RESOLUTION_THROTTLED`. Responses carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The packaged `/s` page resolves a link through `GET /api/public/links/current`.

**Retention.** The `runbookArtifacts` policy (`retention.runbookArtifacts`, "Runbook logs and artifacts": 30 days, on by default, 1 to 365) queues the system job `runbook.artifacts.purge` nightly. For every run that finished before the window it deletes the stored archives, the bundle and the step logs (objects first, then the rows and the step's `log_storage_key`); the run rows, their exit codes and output tails stay. A run whose objects could not all be deleted is retried the next night. With the policy off nothing is purged.

**Web.** The run page `/runs/:id` has an Artifacts tab (`features/runbooks/components/ArtifactsPanel.tsx`): the archives by server, Build bundle with a poll while `building`, Download bundle, and "Share link…" (a link-only dialog over the packaged `useLinkGrants`) for the person who started the run when they hold `sharing:write`. The public `/s#lnk_…` page (the packaged `PublicLinkPage`) renders a `runbook_run` link with `PublicRunBundle`, which calls the public route with the token in `x-link-token`. Presigned URLs are opened and dropped, never logged.

**Metrics.** `app.runbooks.artifact_bytes` (histogram, `kind`: `target_archive`, `bundle`), `app.runbooks.bundle_builds` (counter, `outcome`: `built`, `empty`, `failed`); the sharing slice adds `app.sharing.link_resolutions`. **Audit events:** `runbook_artifact.downloaded`, `runbook_artifact.link_created`. **Failure code:** `ARTIFACT_TOO_LARGE`.

### Runbook safety

Dry run, the destructive guard, the two-person rule and the audit trail (#67). The assessment is `apps/api/src/runbooks/safety/runbook-risk.service.ts`; the command table it reads is `apps/api/src/command-safety/destructive-patterns.ts` (data: add a row, with a true positive and a look-alike in the spec).

**Risk.** `risk: { destructive, risk: 'low'|'medium'|'high', findings: [{ stepId, stepIndex, kind, risk, destructive, reasons[], lines? }] }`, returned by `POST /api/runbooks/validate` and by the runbook and version reads. A `command` or `script` body is classified line by line (`classifyCommand`); `package_update` with `packages: 'all'` is `medium`; a `file_upload` to `/etc/`, `/boot/` or `/usr/` is `medium` (`high`, never destructive, with `overwrite`); an `ai_task` in `autonomous_within_allowlist` mode is `medium` ("AI may run allowlisted commands without approval"). Runbook rows: `rm -rf $X/` and `${X}/*` with an UNQUOTED variable ("unset variable expands to /"), `find / ... -delete`, `truncate -s 0 /var/lib/...` are destructive; `rm -rf "$DIR/"` with a QUOTED variable is `high` but not destructive. A finding names the step and the reasons, never the command text. A definition is destructive when any step is; saving is never blocked.

**Launching a destructive runbook.** `POST /api/runbooks/:id/runs` with no (or a wrong) `confirm` answers `428 RUNBOOK_CONFIRMATION_REQUIRED` with `details: { runbookName, targetCount, requiresApproval, findings }`. Repeat it with `confirm: { runbookName, targetCount }`: the exact name and the number of servers the selector resolves to NOW (so a wrong tag cannot silently widen the blast radius). Unless `runbooks.approvals.allowSelfApproval` is on, the run is then created `queued` with a pending approval of kind `destructive_run` (`awaitingApproval: true`, `approvalId`) and NO start job: it is not dispatched until a different user with `runbooks:approve` approves it (`POST /api/runbook-approvals/:id/decision`; the starter gets `403 RUNBOOK_SELF_APPROVAL`). A rejection (or the approval expiring) sets the run `cancelled` with `errorCode` `APPROVAL_REJECTED` (`APPROVAL_EXPIRED`) and nothing ever ran; cancelling the run while it waits closes the approval. `ai_task` agents never run a destructive command in any mode (#64). Audit events `runbook_run.destructive_confirmed` and `runbook_approval.decided`; metric `app.runbooks.destructive_runs` (`outcome`: `confirmed`, `approved`, `rejected`, `blocked`).

**Dry run.** `dryRun: true` (permission `runbooks:run`, no confirmation) creates a run with `dryRun: true` (badge it DRY RUN). Per target it connects (host key and credential verified as in a real run), refreshes the server facts and then sends one read-only probe per step, recorded as an execution with origin `dry_run`: `command` is not executed (`bash -n` plus `command -v <argv0>` of each binary); `script` is `bash -n` / `sh -n` or `python3 -m py_compile` of a temp file that is removed; `package_update` is the manager's simulation (`apt-get -s`, `dnf|yum --assumeno`, `apk --simulate`, `zypper --dry-run`; brew is `skipped`); `file_upload` checks the directory (`test -d`, `test -w`) and the destination against `overwrite`; `collect_logs` is `ls -la` of the paths estimated against the caps; `ai_task` and `approval_gate` are `skipped` ("not simulated"). Step statuses: `succeeded` (would run), `failed` (`errorCode: DRY_RUN_PRECONDITION`), `skipped`. A dry run creates no approvals (no canary pause), emits no in-process `runbooks.run.finished` event (so no webhook or log collection), and notifies in the app only (`runbooks.dry_run_finished`). Metric `app.runbooks.dry_runs`.

| Route | Permission | Notes |
|-------|------------|-------|
| `GET /api/runbook-runs/:id/audit` | `runbooks:read` | `?page&pageSize` (200, max 1000). `{ items, total, events, commands, page, pageSize }`, oldest first. An item is `{ at, kind: 'event'\|'command', event, userId, approverUserId, serverProfileId, serverName, stepIndex, stepName, origin, commandPreview, commandSha256, exitCode, signal, timedOut, durationMs, outcome, detail, dryRun }`. Events: `run.created`, `run.destructive_confirmed`, `run.started`, `approval.requested`, `approval.decided`, `run.cancel_requested`, `target.cancelled`, `run.finished`. Every executed command appears once |
| `GET /api/runbook-runs/:id/audit/export` | `runbooks:read` | `?format=csv` (default) or `json`: a streamed attachment, not enveloped. CSV is RFC 4180 with CRLF; a text cell starting with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` |
| `GET /api/runbook-commands` | `runbooks:read` | `?serverId&userId&runId&from&to&page&pageSize`: newest first, paginated, only runs the caller may see; each item is a command row plus `id`, `runId`, `runbookId`, `runbookName` |

A command row holds the sha256 of the exact command and its redacted 2 KiB preview, never output; secret values are redacted before storage.

**Reconcile.** A cron queues `runbook.logs.compact` every minute: it fails lost executors, advances stuck runs, expires approvals past `expires_at` (same effect as a rejection, code `APPROVAL_EXPIRED`) and moves log chunks older than an hour to storage.

**Audit events:** `runbook_run.created`, `runbook_run.cancelled`, `runbook_run.target_cancelled`, `runbook_run.destructive_confirmed`, `runbook_approval.decided`. **Metrics:** `app.runbooks.runs_finished`, `app.runbooks.target_duration`, `app.runbooks.commands`, `app.runbooks.approvals`, `app.runbooks.destructive_runs`, `app.runbooks.dry_runs` (bounded labels only). **Nginx:** the stream paths need buffering off (`infra/nginx/app.d/locations/runbook-streams.conf`).
### Runbook schedules and completion events

Recurring runs, the in-app notifications and the webhook events of #66. Code: `apps/api/src/runbooks/schedules/` (the service, controller, the `RunbookSchedulesTask` cron and the `runbook.schedules.tick` handler) and `apps/api/src/runbooks/webhooks/`.

A schedule is a 5-field cron expression evaluated in an IANA time zone, over one runbook, with the parameters, servers and strategy a run needs. It runs **as the person it runs as** (`runAsUserId`: its creator, or whoever last changed its targets, parameters, secrets, strategy or version pin), and that person's permissions are re-checked on every fire. A schedule or runbook the caller cannot see is `404`.

| Route | Permission | Notes |
|-------|------------|-------|
| `GET /api/runbooks/:id/schedules` | `runbooks:read` | `?page&pageSize`. Each item: `id, name, cron, timezone, versionPin, resolvedVersion, params, secretRefs` (names only), `targets, strategy, overlap, enabled, nextRunAt, lastRunId, lastRunStatus, lastFiredAt, runAsUserId, disabledReason, destructive, approval: { state, approvedBy, approvedAt, approvedVersion }`. `approval.state`: `not_required`, `pending`, `approved` (this version), `stale` (an earlier version) |
| `GET /api/runbooks/:id/schedules/:scheduleId` | `runbooks:read` | One schedule |
| `POST /api/runbooks/:id/schedules` | `runbooks:write` + `runbooks:run` | `{ name, cron, timezone, versionPin?: 'latest' \| versionId, params?, secretRefs?, targets?, strategy?, overlap?: 'skip' \| 'queue' \| 'allow', enabled?, confirm? }`. `422 RUNBOOK_SCHEDULE_INVALID` (`details.field`: `cron`, `timezone`, `versionPin`), `422 RUNBOOK_PARAMS_INVALID` / `RUNBOOK_SECRET_REF_UNKNOWN`, `428 RUNBOOK_CONFIRMATION_REQUIRED` for a destructive runbook |
| `PATCH /api/runbooks/:id/schedules/:scheduleId` | `runbooks:write` + `runbooks:run` | Any field above; `strategy: null` clears the override. `409 RUNBOOK_SCHEDULE_APPROVAL_REQUIRED` when enabling an unapproved destructive schedule |
| `DELETE /api/runbooks/:id/schedules/:scheduleId` | `runbooks:write` + `runbooks:run` | `204`. Its past runs stay, with `scheduleId` cleared |
| `POST /api/runbooks/:id/schedules/:scheduleId/approve` | `runbooks:approve` | The second person of a destructive schedule; approves the version it would run now and, if it was waiting for that, enables it. `403 RUNBOOK_SCHEDULE_SELF_APPROVAL` for the person it runs as unless `runbooks.approvals.allowSelfApproval` |
| `POST /api/runbooks/:id/schedules/:scheduleId/run-now` | `runbooks:run` | `202` as for a run; runs as the caller, does not move `nextRunAt`. `409 RUNBOOK_SCHEDULE_OVERLAP` (overlap `skip`, previous run active) or `RUNBOOK_SCHEDULE_APPROVAL_REQUIRED` |
| `GET /api/runbook-schedules/preview?cron=&timezone=` | `runbooks:read` | `{ cron, timezone, next: [5 ISO times] }`, for the editor; `422 RUNBOOK_SCHEDULE_INVALID` |

**Firing.** A cron queues the system job `runbook.schedules.tick` every minute (`enqueueHousekeepingJob`; the cron does no work). The handler finds the schedules with `enabled` and `nextRunAt <= now`, and for each one, inside its organization: (1) claims the slot with a guarded update of `next_run_at` to the first slot strictly after now (two ticks racing create one run; a missed slot is **not** caught up); (2) checks that the person it runs as is active and holds `runbooks:run` and `servers:read` and may run the runbook, that the runbook is not archived, that the pinned version exists and, for a destructive version, that it is approved for **that** version; (3) applies `overlap` (`skip`: nothing is created while the previous run has not finished; `queue` and `allow` always create the run); (4) creates the run with `trigger: 'schedule'` and `scheduleId`, and its `runbook.run.start` job, exactly as a manual launch does. A claimed slot whose run cannot be created is lost, never repeated. A schedule fires within a minute of its time.

**Switched off by the system** (`enabled: false`, `nextRunAt: null`, `disabledReason`, and an in-app notification `runbooks.schedule_disabled` to the person it runs as): `PERMISSION_REVOKED`, `APPROVAL_REQUIRED`, `RUNBOOK_ARCHIVED`, `VERSION_MISSING`, `RUN_REJECTED` (the run was refused: parameters, a secret or the servers no longer valid).

**Destructive runbooks (#67).** A scheduled run carries no per-run confirmation and no per-run approval, so both happen once, to the schedule: creating (or materially changing: targets, parameters, secrets, strategy, version pin) a schedule of a destructive version needs `confirm: { runbookName, targetCount }` (`428` otherwise), and then a person other than the one it runs as, holding `runbooks:approve`, approves it. Until then it is `enabled: false` with `disabledReason: APPROVAL_REQUIRED`. The approval covers one version: a new destructive version under `versionPin: 'latest'` switches the schedule off at its next slot until it is approved again. With `runbooks.approvals.allowSelfApproval` the confirmation is the approval.

**Notifications.** When a scheduled run finishes the person who ran it gets `runbooks.run_finished` (succeeded) or `runbooks.run_failed` (`failed`, `partially_failed`, `aborted`), after the commit; when a "run now" by someone else finished, the schedule's owner is told too. A cancelled run notifies nobody, and a dry run only in the app.

**Webhooks** (`apps/api/src/runbooks/webhooks/runbooks.webhooks.ts`; event keys are permanent; audience `org`, permission `runbooks:read`, raised after the commit):

| Event | Payload |
|-------|---------|
| `runbook.run.completed` | `{ runId, runbookId, runbookName, version, status: 'succeeded' \| 'partially_failed' \| 'failed' \| 'aborted' \| 'cancelled', trigger, scheduleId?, counts: { total, succeeded, failed, cancelled, skipped }, startedAt, finishedAt, url }`. Not raised for a dry run |
| `runbook.approval.requested` | `{ approvalId, runId, kind, runbookName, expiresAt, url }`, no command text |

Payloads carry metadata only: never a command, output, parameter, secret or host (the schemas are strict).

**Audit events:** `runbook_schedule.created`, `.updated`, `.deleted`, `.approved`, `.run_now`. **Metric:** `app.runbooks.schedule_fires` (`outcome`: `fired`, `skipped_overlap`, `disabled`, `failed`). **Rollback:** disable the schedules first (`UPDATE runbook_schedules SET enabled = false`); webhook event keys stay registered once an endpoint subscribed.

### Runbook AI steps

The `ai_task` step and AI drafting (#64). The agent is `apps/api/src/runbooks/ai/`; the policy is `agent-policy.ts` (pure), what a model may see of an output is `agent-output.ts` (pure).

**The step.** `{ kind: 'ai_task', goal, approvalMode, allow[], deny[], tools[], maxSteps, maxOutputTokens, commandTimeoutSec, runAs }` (see the definition schema; `allow` and `deny` are RE2 patterns, `maxSteps` 1 to 20 default 8, `tools` any of `run_command`, `read_file`, `list_dir`). `runbook.target.run` marks the step `running`, parks the target `waiting` and queues `ai.runbook.agent` (`{ runId, targetId, stepIndex, orgId, phase: 'start' | 'resume' }`, ids only, `maxRuntimeMs` 30 minutes, `maxAttempts` 1). When the step ends the job queues `runbook.target.run` for the step after it, so `always` and `on_failure` steps still run after a failed AI step. The job is server-only for good: no `nodeResultSchema`, no `persistNodeResult`; the AI key and the SSH credential never leave the API process. A dry run does not simulate it (`skipped`).

**Before any provider call or SSH connection** the step fails with a code: `AI_DISABLED` (the platform switch, deployment or organization), `RUNBOOK_AI_DISABLED` (`runbooks.ai.agentEnabled`), `AI_OUTPUT_SHARING_DISABLED` (the server's `aiOutputSharing` is off: an agent cannot work blind), `PERMISSION_REVOKED` (the starter no longer holds `runbooks:run` and `ai:use`). The calls run as the starter: `AiService.forUser(starter, { orgId, feature: 'runbook_agent' })`, under the starter's own key.

**Command policy** (every mode, before anything is asked of a person or sent to a server). A `run_command` is allowed only when it matches no `deny` pattern, is not destructive (`classifyCommand`, so `allow: ['.*']` does not open `mkfs.ext4`), names no sensitive path (`/etc/shadow`, `/etc/gshadow`, any `.ssh`, `*.pem`, `*.key`, `/etc/ssl/private`, `/proc/*/environ`) and, in `autonomous_within_allowlist` mode, matches at least one `allow` pattern. `read_file` (`head -c`, at most 64 KiB) and `list_dir` (`ls -la --`) are always allowed except for those paths. A refused call is answered to the model as `{ refused: true, reason }`, written as a command execution with `outcome: 'refused'` and counted; the third refusal ends the step `AI_POLICY_VIOLATIONS`. Patterns are RE2 (linear time); one that does not compile fails closed.

**Modes.**

| Mode | What happens |
|---|---|
| `autonomous_within_allowlist` | `runTools` over the three tools; the policy judges each call; `maxSteps` model rounds (the last round's calls are not run: `AI_STEP_LIMIT`) |
| `per_command` | A `run_command` is not executed: an approval of kind `ai_command` is created (`payload: { command, reason, commandSha256 }`, the command redacted), the conversation is stored in `runbook_run_steps.ai_transcript`, the step is `waiting_approval` and the job ends. Approve: step `running`, the job resumes with `phase: 'resume'`, runs exactly the approved command (its sha256 must match: `AI_APPROVAL_MISMATCH`) and carries on. Reject: the model is told `{ rejected: true, comment }` and carries on. Expiry: the step fails `APPROVAL_EXPIRED`. One approval per command; the person who started the run cannot approve it unless `runbooks.approvals.allowSelfApproval` |
| `plan` | One structured call returns `{ summary, commands[1..20] }` (no tools); every command is policy-checked and the plan is shown with the refused ones marked (`payload: { summary, commands: [{ command, reason, refused }], planSha256 }`, kind `ai_plan`). Approve: the commands run exactly as approved, in order, a refused one is skipped, the first failure stops the plan unless `continueOnError`, then one closing call summarises. Reject or expiry: the step fails `APPROVAL_REJECTED` or `APPROVAL_EXPIRED`. The model cannot add a command after approval |

**What the model sees.** The goal, the server's facts (OS, distribution, package manager), the policy patterns, the step budget and the non-secret parameter values; a secret parameter appears by NAME only (`$TOKEN`). A tool result is `{ exitCode, output }` with the output stripped of ANSI, redacted (the run's secret values as `[REDACTED:literal]`, shaped secrets as `[REDACTED:<kind>]`) and cut to 8 KiB (`[truncated]`). Commands run over the same SSH connection, stdin prelude, `runAs` and `commandTimeoutSec` as a `command` step.

**Audit.** Every command, run or refused, is a `runbook_command_executions` row with `origin: 'ai_agent'`, `outcome` (`succeeded`, `failed`, `timed_out`, `cancelled`, `refused`, `rejected`) and `approvedBy` (the approver; null when none was needed), and an audit event `runbook_agent.command` (`decision`: `executed`, `refused`, `rejected`, `pending_approval`; the sha256, never the text). The model's turns, commands and the exit codes are in the step's log as `system` lines (`[ai] ...`), live in the log stream; the closing text is `aiSummary` on the step.

**Failure codes** of an AI step (`error_code`): `RUNBOOK_AI_DISABLED`, `AI_DISABLED`, `AI_OUTPUT_SHARING_DISABLED`, `AI_POLICY_VIOLATIONS`, `AI_STOPPED`, `AI_STEP_LIMIT`, `AI_APPROVAL_MISMATCH`, `AI_FAILED`, the platform's own AI codes (`AI_KEY_REQUIRED`, `AI_INVALID_REQUEST` when the starter has no default model, ...), and the engine's `PERMISSION_REVOKED`, `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`, `EXECUTOR_LOST`, `SSH_*`, `HOST_KEY_*`, `CANCELLED`. A provider throttle with no command run in the attempt defers the job; with a command already run it fails the step (a retry would repeat it).

| Route | Permission | Notes |
|-------|------------|-------|
| `POST /api/runbook-runs/:id/ai/stop` | `runbooks:run` | `202 { id, stopRequested: true, stoppedSteps }`. Sets `ai_stop_requested_at` on the run: every agent reads it before each tool execution (and while a command runs), so it ends `AI_STOPPED` before its next command; an AI step parked behind a pending approval fails at once and its approval is closed (`rejected`, "AI stopped"). The run itself carries on. Not behind the AI switch: stopping must work when AI is off. `404` for a run the caller may not run, `409 RUNBOOK_RUN_STATE` for a finished run |
| `POST /api/ai/runbooks/draft` | `ai:use` (and `runbooks:write`, checked in the handler) | `{ prompt (1..4000), targetHint?: { serverIds?: uuid[], tags?: string[] } }` answers `200 { definition, warnings[], risk }`. The definition is valid under the runbook schema (an invalid model answer is `502 AI_STRUCTURED_OUTPUT_INVALID`, never returned). It is NOT saved and NOT run: load it into the builder and save it with `POST /api/runbooks`. `warnings` are `{ code, path, message }`: the definition warnings of validation, one per risky step (`RISK_MEDIUM`, `RISK_HIGH`, `DESTRUCTIVE_STEP`; reasons only, never the command) and `SECRET_IN_DRAFT` when anything secret-shaped is in the draft. Only the facts (name, OS, package manager) of hinted servers the caller may read reach the model, never terminal output. `403 AI_DISABLED`, `403` without `runbooks:write`, behind `AiEnabledGuard` and the organization AI switch |

**Reconcile.** The sweep also fails a parked target whose AI step is `running` with no `ai.runbook.agent` job pending or running (`EXECUTOR_LOST`): the job is never retried, and the target goes on at the next step.

**Metrics:** `app.runbooks.ai_tool_calls` (`tool`: `run_command`, `read_file`, `list_dir`; `decision`: `executed`, `refused`, `pending_approval`, `rejected`) and the existing `app.runbooks.commands` with `origin: ai_agent`, `app.runbooks.approvals` with kinds `ai_command` and `ai_plan`. The agent's provider calls are `ai.request` spans (`ai.feature=runbook_agent`, `runbook_draft`) under the job's span.

**Rollback.** Revert the PR. Without a revert, set `runbooks.ai.agentEnabled` to false (system or organization) or switch AI off: `ai_task` steps then fail fast with no provider call and no SSH connection. The new columns are nullable and stay unused.

### Sharing: groups, shared servers and shared runbooks

Server profiles and runbooks are private to their owner until shared (#71). The sharing slice (`@marinoscar/platform-api/sharing`) provides the routes; ShellKeep registers two resource types, `server_profile` and `runbook`, and every decision is `AccessPolicy`'s. A record the caller may not see is **404, never 403**, so existence is never disclosed; a missing RBAC permission (for example `sessions:write` to connect) is a 403 naming it. A grant carries a **role, never a credential**.

| Route | Permission | Notes |
|---|---|---|
| `GET /api/groups`, `POST /api/groups`, `GET`/`PATCH`/`DELETE /api/groups/:id` | `groups:read`, `groups:write` | Groups of the active organization. `DELETE` answers `409` with `details.reason: "GROUP_OWNS_RESOURCES"` and `details.counts` while the group owns a server profile or a runbook |
| `GET`/`POST /api/groups/:id/members`, `PATCH`/`DELETE /api/groups/:id/members/:userId`, `GET`/`POST /api/groups/:id/invites`, `GET /api/groups/invites/mine` | `groups:read`, `groups:write` | Group roles `admin`, `editor`, `viewer` |
| `GET /api/grants?resourceType&resourceId`, `POST /api/grants`, `PATCH`/`DELETE /api/grants/:id` | `sharing:read`, `sharing:write` | Share one record with a user (`{ kind: "user", userId }` or `email`) or a group (`{ kind: "group", groupId }`) with a role; needs the `share` action on the record (its owner) |
| `GET /api/grants/shared-with-me` | `sharing:read` | Active grants to the caller or their groups |
| `POST /api/grants/links` | `sharing:write` | **`422` with `details.reason: "ROLE_NOT_GRANTABLE"`** for both types: links are off. The one exception is a run's log bundle, type `runbook_run` (see Runbook logs and artifacts) |

**Server profile roles** (`owner` is implicit): `viewer` reads the profile (never a credential); `operator` also tests the connection, opens sessions and runs runbooks on it; `editor` also changes the name, tags, color and host-key trust. A member of the owning group holds `admin` as `owner`, `editor` as `operator`, `viewer` as `viewer`, so a group admin can share and delete a group-owned profile (and then retire the group) while a group editor cannot. `share` and `delete` need `owner`; `owner` never reaches the credential (see `SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY` below). Each action also needs its RBAC permission, even for the owner: `connect` needs `sessions:write`, `run` needs `runbooks:run`, `write` needs `servers:write`, `delete` needs `servers:delete`.

**Runbook roles**: `viewer` reads (and previews targets), `runner` also runs, `editor` also saves versions, edits metadata and archives. The group mapping is `admin` as `owner`, `editor` as `runner`, `viewer` as `viewer`; `share` and the permanent delete need `owner` (the creator, or an admin of the owning group); `run` needs `runbooks:run`, `write` needs `runbooks:write`.

**Server profiles.**
- `GET /api/server-profiles` lists what the caller may see; `?filter=mine|shared|all`. `POST /api/server-profiles` and `POST /api/runbooks` accept `ownerGroupId` (the caller must be an `admin` or `editor` of that group, `403 GROUP_ROLE_INSUFFICIENT` for a viewer, `404` for a group they are not in).
- Every item carries `owner` (`{ kind: "user" | "group", id, name }`) and `access` (`{ role, via, shared, credentialHolder, can: { connect, test, write, share, delete } }`; a runbook's `can` is `{ run, write, share }`). The `has*` credential flags are returned **only to the user who saved the credentials**; a grantee gets none of them.
- The SSH secrets stay in the credential store of the user who saved them and are read server-side only, for `POST /api/server-profiles/:id/test`, the host-key and facts routes, the session history download and the terminal socket. A grantee's `PATCH` that changes the hostname, port, username, auth method or a secret answers `403 SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY`, so a share can never redirect a stored credential to another host.
- Per route: `GET` needs `read` (viewer); `POST /:id/test`, `/host-key/scan` and `/facts/refresh` need `test` (operator); `PATCH`, `POST /:id/host-key/trust` and `DELETE /:id/host-key` need `write` (editor); `DELETE /:id` needs `delete` (owner). A grantee below the role gets 404.
- `POST /api/sessions` needs `connect` on the profile (404 otherwise); the session is the caller's own, so each person who connects opens their own tmux session. The terminal socket checks `connect` again on every attach: a revoked share answers `NOT_FOUND`.
- `DELETE /api/server-profiles/:id` (the owner) removes the grants on it in the same transaction.

**Audit events.** The slice audits shares, revocations and group membership. ShellKeep adds `server_profile.connect_as_grantee` (actor, profile id, `ownerUserId`, `ownerGroupId`, `purpose`: `connect`, `test`, `history` or `run`; never a secret) whenever a credential is read for a caller who did not save it. Metric: `app.sharing.access_decisions` (`resource_type`, `outcome`, `via`).

### Dashboard

The Home page's one read (#78). `GET /api/dashboard/summary` requires `sessions:read`; it is read-only and bounded (a fixed number of counts plus the five most recent rows, no N+1).

```json
{
  "data": {
    "servers": { "total": 14, "reachable": 9, "unreachable": 2, "unknown": 3, "hostKeyUntrusted": 3 },
    "sessions": {
      "active": 5, "attached": 2, "detached": 3,
      "recent": [{ "id": "…", "name": "deploy-hotfix", "status": "active", "serverProfileId": "…", "serverName": "server-a", "lastActivityAt": "…", "createdAt": "…" }]
    },
    "runs": null
  }
}
```

- **Scope.** `servers` counts the profiles the caller may see (own, owned by a group of theirs, shared with them; the sharing slice's `accessibleWhere`) and is `null` without `servers:read`. `sessions` covers the caller's own non-terminated sessions in the request's organization; `recent` is newest activity first, at most five, and carries the server's name, never its hostname.
- **Reachability.** Counted from the stored outcome of each server's last connection test (#79), with the same definition as the Servers page's `health` filter, so `/servers?health=unreachable` lists exactly the servers the tile counts; a server never tested is `unknown`. The dashboard never opens SSH. `hostKeyUntrusted` counts servers with no trusted fingerprint (#60), the same set as `/servers?hostKey=untrusted`.
- **Runs.** `null` without `runbooks:read`; otherwise `{ running, failedLast24h, recent: [{ id, runbookId, runbookName, status, targets: { total, succeeded, failed, running }, startedAt }] }` over the runs the caller started or may read through a runbook shared with them (the Runs list's rule), from `DASHBOARD_RUNS_SOURCE` (`apps/api/src/dashboard/dashboard-runs.source.ts`), bound by `RunbooksModule`. `running` counts status `running` and `failedLast24h` status `failed` queued in the last 24 hours, so each tile equals the total of the Runs list it links to; `recent` is the five newest.
- The response is validated against `dashboardSummarySchema` (`apps/api/src/dashboard/dashboard.schema.ts`). One span per request, `dashboard.summary`; no hostname in a log or span.

---

### Onboarding

The Getting started checklist, the administrator's Setup guide and the activation metrics (#70), from the platform onboarding slice (`@marinoscar/platform-api/onboarding`, bound in `apps/api/src/platform/onboarding/`). Nothing is stored but the caller's UI state in the `onboarding` user-settings namespace; every step is derived per request, so creating a server or opening a session completes its step on the next read.

| Route | Permission | Notes |
|---|---|---|
| `GET /api/onboarding` | `user_settings:read` | `{ settings, user, admin }`. `admin` (the Doctor-backed Setup guide: storage, email, allowlist, AI, Web Push, backups) is non-null only with `system_settings:read`. `?refresh=true` re-runs the Doctor checks. Read-only: never creates a settings row |
| `GET /api/admin/onboarding/metrics` | `system_settings:read` | Aggregate activation metrics over new users (`?days=`): the cohort, the step funnel and the `shellkeep_first_session_opened` milestone (first terminal session within 7 days). Counts only; no hostname or row content |
| `PATCH /api/user-settings` `{ onboarding: { welcomeSeenAt?, checklistDismissedAt?, adminDismissedAt?, skipped? } }` | `user_settings:write` | Stores the UI state. A `skipped` id that is not a registered, skippable step is `400` |

ShellKeep's steps (audience `user`; ids are permanent, a user's `skipped` list stores them). Each reads one count over the caller's own rows in the request's organization (`apps/api/src/app-registrations/onboarding.ts` lists them; each is declared beside its domain):

| Order | Step | Tier | Done when | Link | Permission |
|---|---|---|---|---|---|
| 10 | `shellkeep.add-server` | required | `shellkeep.serverProfileCount` > 0 | `/servers?new=1` | `servers:write` |
| 20 | `shellkeep.trust-host-key` | required | `shellkeep.trustedHostKeyCount` > 0 (a stored fingerprint, #60) | `/servers` | `servers:write` |
| 30 | `shellkeep.open-session` | required | `shellkeep.sessionCount` > 0 (any status) | `/sessions?new=1` | `sessions:write` |
| 40 | `shellkeep.add-ai-key` | recommended, skippable, `feature: 'ai'` | `shellkeep.aiKeyCount` > 0 (`user_ai_keys`) | `/settings/ai` | `ai:use` |
| 50 | `shellkeep.first-runbook` | recommended, skippable | `shellkeep.runbookCount` > 0 (authored, not archived; read under RLS) | `/runbooks` | `runbooks:write` |

- A step whose permission the caller lacks is omitted, never shown blocked; while the AI kill switch is off `shellkeep.add-ai-key` is omitted. A fact that fails (no active organization on the credential) omits its steps and never fails the response.
- The platform's own user steps (`user.profile`, `user.notifications`) follow ShellKeep's in the same block. Boot fails if a step names an unregistered fact (`assertOnboardingRegistries`); the `onboarding` conformance suite runs in `apps/api/test/onboarding/onboarding-conformance.spec.ts`.

---

### Data export

Every signed-in user can download their own data (#68). The exports slice (`@marinoscar/platform-api/exports`) provides the routes; the work runs as the server-only job `export.run` and the file expires through `export.purge` (7 days). **No credential ever leaves the server**: no SSH password, private key, passphrase or credential ciphertext (`encryptedPassword`, `encryptedPrivateKey`, `encryptedPassphrase` included), and no tmux scrollback or log content. Another user's export is **404, never 403**.

| Route | Permission | Notes |
|---|---|---|
| `GET /api/exports/sources` | any signed-in user | The sources the caller may use, with their formats and request fields; each source is listed only to a caller holding its permission |
| `POST /api/exports` | the source's permission | `{ source, format, request? }`; `202` with a `pending` export. `400` for an unknown source or format or a request the source refuses; `429` at three exports in flight |
| `GET /api/exports` | any signed-in user | The caller's own exports, newest first |
| `GET /api/exports/:id` | any signed-in user | One export; when `ready` it carries a 5-minute signed URL with `Content-Disposition: attachment` |

| Source | Permission | Request | Contents |
|---|---|---|---|
| `user-data` | `user_settings:read` | none | The caller's whole record, one dataset per user-owned model (server profiles without any credential, terminal sessions, runbooks the caller authored with their versions, settings, tokens' metadata) |
| `server-profiles` | `servers:read` | `{ includeShared?: boolean }` | Name, host, port, user, auth method, tags, color, host key fingerprint, timestamps. `includeShared` adds profiles other people shared with the caller (decided by the sharing slice), with the same columns |
| `terminal-sessions` | `sessions:read` | `{ from, to, status? }` (`YYYY-MM-DD`, both days inclusive, in the caller's time zone, by creation day) | Metadata only: name, status, tmux session name, size, server profile id, timestamps |
| `runbook-runs` | `runbooks:read` | `{ from, to, runbookId? }` | The requester's own runs created in the range, as five datasets: runs, targets, steps, approvals and command executions (status, timings, exit codes, counts, command SHA-256). Parameters, secret references, step output, AI text, command text, approval comments and artifacts are never exported |

Formats: `json`, `csv` (a zip of one CSV per dataset) and `xlsx`. Audit: `export:create` after the job commits. Metrics: `app.exports`, `app.export.duration`, `app.export.size` (no user id label). Notifications: `export.ready` and `export.failed` (a fixed message).

---

### User data deletion and factory reset

The user-data slice (`@marinoscar/platform-api/user-data`, #69) provides three destructive flows, each a server-only queue job behind a typed phrase that the API re-checks (`400 CONFIRMATION_MISMATCH` on a wrong one). No ShellKeep route of its own: the decisions are registry data in `apps/api/src/app-registrations/user-data.ts`.

| Route | Permission | Notes |
|---|---|---|
| `GET /api/user-data/summary` | `user_settings:write` (every role) | The categories with the caller's counts, the scopes with their phrases, and the "always kept" lines |
| `POST /api/user-data/deletions` | `user_settings:write` | `{ scope, confirmation }`; `202` with the `user.data.purge` job (one pending or running purge per user; a second request returns it) |
| `GET /api/user-data/deletions/:jobId` | `user_settings:write` | The caller's own job and, once done, its counts; `404` for anyone else's |
| `GET /api/admin/factory-reset/summary`, `POST /api/admin/factory-reset`, `GET /api/admin/factory-reset/:jobId` | `system:factory_reset` (Admin only; never implied by `system_settings:write`) | Phrase `FACTORY RESET`; `403 FACTORY_RESET_DISABLED_IN_SAAS` in SaaS mode |
| `/api/admin/orgs/:orgId/offboarding/*` | `orgs:offboard` (Admin only) | Multi-organization mode only (`409` otherwise); ShellKeep runs one organization, so the routes exist but are unused |

| Scope | Phrase | Deletes |
|---|---|---|
| `servers` | `SERVERS` | Categories `servers` and `sessions`: every server profile (a group-owned one the user created too, because its saved credentials are theirs), the grants on them, their saved `ssh` credentials (through `UserCredentialsService`) and every terminal session |
| `runbooks` | `RUNBOOKS` | Category `runbooks`: every runbook only the user owns, with its versions, runs, targets, steps, buffered logs, command audit rows, approvals, grants and the saved step logs in object storage. A runbook a group owns stays with the group (its author link is nulled), and so do its runs |
| `content`, `everything` | `DELETE MY CONTENT`, `DELETE MY DATA` | The platform's built-ins, now reaching the three ShellKeep categories as well |

Runs the user started and approvals they decided on a runbook that stays are kept as organization history with the actor id nulled. The account, memberships (organization and group), roles, the session and the audit log are never deleted by a data purge.

The factory reset keeps the administrator, configuration and database backups (their runs, archives and linked jobs), and runs two ShellKeep steps before the users go: `shellkeep.terminal.disconnect` marks every `active` terminal session `terminated` (it opens no SSH connection: tmux sessions already running on the servers keep running) and `shellkeep.servers.reset` deletes every server profile, the administrator's included. Step logs of runbook runs are object-storage keys with no `storage_objects` row, so the reset's storage step does not see them: run `npm run storage:purge` afterwards to sweep the `runbook-artifacts/` prefix.

Job types (permanent): `user.data.purge`, `admin.factory_reset`, `org.offboard`, and ShellKeep's two delegated halves of the purge, `servers.user_data.purge` and `runbooks.user_data.purge`. Audit: `user_data.purge.requested|completed`, `admin.factory_reset.requested|completed`. The jobs log ids and counts only: never a hostname, user name, credential name, runbook name or log line.

---

### Android app

The android-app slice (`@marinoscar/platform-api/android-app`, #74) serves the Android companion's server half: the trusted apps and the public Digital Asset Links file, the hosted APK releases, signed download links and a test notification. ShellKeep adds no route of its own. Tag `Android App` in the OpenAPI reference.

| Route | Permission | Notes |
|---|---|---|
| `GET /.well-known/assetlinks.json` (nginx rewrites it to `GET /api/well-known/assetlinks.json`) | Public, served during maintenance | The trusted list as Digital Asset Links; `[]` before any app is trusted |
| `GET /api/admin/android-app`, `GET /api/admin/android-app/releases` | `system_settings:read` | Trusted apps, the reported apps of paired devices, push counts, the releases |
| `PUT /api/admin/android-app`, `POST /api/admin/android-app/test-notification` | `system_settings:write` | Replace the trusted list; send a test notification over the `android_app` channel |
| `POST /api/admin/android-app/releases`, `POST .../releases/:id/make-current`, `DELETE .../releases/:id` | `system_settings:write` | Streamed multipart upload (150 MiB), rollback, delete |
| `GET /api/android-app/releases/latest`, `POST /api/android-app/releases/:id/download-link` | Any signed-in user | The current release; a 10-minute HMAC link bound to the caller |
| `GET /api/android-app/download/:token` | Public (the token is the credential) | Streams the APK |

Errors worth knowing: `409 RELEASE_UNTRUSTED_APP`, `409 RELEASE_VERSION_NOT_NEWER`, `409 RELEASE_CURRENT_CONFLICT`, `410 DOWNLOAD_LINK_EXPIRED`, `503 STORAGE_NOT_CONFIGURED`. Audit events: `android_app.trusted_apps.updated`, `android_app.release.uploaded|made_current|deleted`, `android_app.test_notification.sent`. Objects live under `android-releases/` and survive a factory reset.

---

### Health

**Public endpoints** - Used for Kubernetes liveness/readiness probes.

#### GET /health
Full health check - includes database connectivity test. Equivalent to GET /health/ready.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

**Error Cases:**
- 503 Service Unavailable - Database connection failed

---

#### GET /health/live
Liveness check - always returns 200 if service is running.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

#### GET /health/ready
Readiness check - includes database connectivity test.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "database": "ok"
  }
}
```

**Error Cases:**
- 503 Service Unavailable - Database connection failed

---

## HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | OK - Request successful |
| 201 | Created - Resource created successfully |
| 204 | No Content - Request successful, no response body |
| 400 | Bad Request - Invalid request format or validation error |
| 401 | Unauthorized - Missing or invalid authentication token |
| 403 | Forbidden - Insufficient permissions or user disabled |
| 404 | Not Found - Resource not found |
| 409 | Conflict - Resource already exists or version mismatch (optimistic concurrency) |
| 500 | Internal Server Error - Server error occurred |
| 503 | Service Unavailable - Service temporarily unavailable |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AUTH_REQUIRED` | 401 | No valid authentication token provided |
| `INVALID_TOKEN` | 401 | JWT token is invalid or expired |
| `FORBIDDEN` | 403 | User does not have required permissions |
| `USER_DISABLED` | 403 | User account is disabled |
| `NOT_FOUND` | 404 | Requested resource not found |
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `CONFLICT` | 409 | Resource already exists or version mismatch |
| `NOT_AUTHORIZED` | 403 | Email not in allowlist |
| `VERSION_MISMATCH` | 409 | Optimistic concurrency conflict (If-Match header) |
| `HOST_KEY_UNKNOWN` | 409 | The server has no trusted SSH host key yet; verify and trust its fingerprint first |
| `HOST_KEY_MISMATCH` | 409 | The server presented a different SSH host key than the trusted one; refused before any credential was sent |
| `HOST_KEY_CHANGED_DURING_TRUST` | 409 | The key presented now is not the fingerprint the user confirmed |
| `HOST_KEY_CONFIRMATION_REQUIRED` | 400 | Replacing a trusted host key needs the profile hostname typed as `confirmHostname` |
| `SSH_HOST_UNREACHABLE` | 502 | The SSH server could not be reached to read its host key |
| `PRECONDITION_FAILED` | 412 | A stale `If-Match` (for example replacing a runbook definition that has a newer version) |
| `RUNBOOK_DEFINITION_INVALID` | 422 | The runbook definition failed validation; `details.issues` lists each problem with its path |
| `RUNBOOK_TARGET_GROUPS_UNAVAILABLE` | 422 | The target selector names server groups, which are not available yet |
| `RUNBOOKS_DISABLED` | 503 | Runbooks are switched off (`runbooks.enabled`) |
| `RUNBOOK_PARAMS_INVALID` | 422 | A run parameter failed the definition; `details.issues` |
| `RUNBOOK_SECRET_REF_UNKNOWN` | 422 | A secret reference names a runbook secret that does not exist |
| `RUNBOOK_NO_TARGETS` | 422 | Nothing to retry or no server to run on |
| `RUNBOOK_SELF_APPROVAL` | 403 | The person who started a run may not approve it |
| `RUNBOOK_APPROVAL_NOT_PENDING` | 409 | The approval was already decided or expired |
| `RUNBOOK_RUN_STATE` | 409 | The run is not in a state that allows this action |
| `RUNBOOK_NAME_TAKEN` | 409 | Another live runbook in the organization has this name |
| `RUNBOOK_ARCHIVED` | 409 | The runbook is archived; restore it before changing it |
| `RUNBOOK_HAS_ACTIVE_RUNS` | 409 | The runbook has a run that has not finished, so it cannot be deleted yet |
| `RUNBOOK_IF_MATCH_REQUIRED` | 428 | Replacing a definition needs an `If-Match` header |

---

## Rate Limits

> **Note:** Rate limiting is recommended for production deployments but is not currently implemented in the application. Consider adding `@nestjs/throttler` or Nginx rate limiting before production deployment.

**Recommended limits:**

| Endpoint Pattern | Recommended Limit | Window |
|------------------|-------------------|--------|
| `/api/auth/*` | 10 requests | 1 minute |
| `/api/allowlist` (POST) | 30 requests | 1 minute |
| `/api/system-settings` (PUT/PATCH) | 30 requests | 1 minute |
| All other endpoints | 100 requests | 1 minute |

---

## Swagger/OpenAPI Documentation

Interactive API documentation with request/response examples is available at:

**Development:** http://localhost:8323/api/docs

The Swagger UI allows you to:
- Explore all endpoints
- View request/response schemas
- Test API calls directly from the browser
- Authenticate with JWT tokens

---

## CORS Policy

The API uses a **same-origin architecture**. Both the frontend and API are served from the same host (via Nginx reverse proxy):

- Frontend: `http://localhost:8323/`
- API: `http://localhost:8323/api`

This eliminates CORS complexity and improves security. No cross-origin requests are required.

---

## Security Headers

All API responses include security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

## Versioning

The API currently does not use versioning (v1, v2, etc.). Breaking changes will be avoided when possible. When breaking changes are necessary, they will be:

1. Announced in advance
2. Documented in migration guides
3. Implemented with a transition period when feasible

For future versions, the API may adopt URL-based versioning: `/api/v2/...`
