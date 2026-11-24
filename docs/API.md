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
Permission `servers:read`. `{ "success": true }`, or `{ "success": false, "error": "..." }`. A refused host key adds `"code": "HOST_KEY_UNKNOWN" | "HOST_KEY_MISMATCH"`, `"presented": { "fingerprint", "algorithm" }` and `"expected": "<fingerprint>" | null`. A successful test also refreshes the server facts.

#### POST /server-profiles/:id/facts/refresh
Permission `servers:write`. Probes the server now (one fixed read-only command) and returns `{ "facts": { "kernel", "os", "distroId?", "distroVersion?", "prettyName?", "shell?", "has": [], "packageManager?" }, "factsProbedAt" }`. `409 HOST_KEY_UNKNOWN | HOST_KEY_MISMATCH` (with `details.presented`, `details.expected`, `details.serverProfileId`) when the key is not trusted. `GET /sessions/:id/history` answers the same 409 for a refused key.

---

### Runbooks

Versioned, reusable multi-step procedures (#61). Definitions can hold sensitive commands, so every route requires a runbook permission in the caller's organization: `runbooks:read` for reads and target preview, `runbooks:write` for everything that changes a runbook, validates a definition or touches a secret. (`runbooks:run` and `runbooks:approve` are enforced by the run engine and the approvals inbox, #62.)

| Route | Permission | Notes |
|-------|------------|-------|
| `GET /api/runbooks` | `runbooks:read` | Paginated (`page`, `pageSize`); filters `q` (name or description), `tag`, `includeArchived`, and `filter` (`all` default, `mine`, `shared`). Lists only the runbooks the caller may see (#71): theirs, their groups' and those shared with them; each item has `owner` and `access` |
| `GET /api/runbooks/:id` | `runbooks:read` | Latest version embedded; `ETag: "v<version>"` |
| `POST /api/runbooks` | `runbooks:write` | `{ name, description?, tags?, definition, changelog? }` creates the runbook and version 1 |
| `PUT /api/runbooks/:id/definition` | `runbooks:write` | `{ definition, changelog? }`; needs `If-Match: "v<n>"` (the ETag of a GET). Creates version n+1 and returns the new `ETag`; a definition identical to the latest (same sha256) is a 200 with `created: false` and no new version |
| `PATCH /api/runbooks/:id` | `runbooks:write` | Metadata only: `name`, `description`, `tags` |
| `DELETE /api/runbooks/:id` | `runbooks:write` | Archives (soft delete), idempotent; 204 |
| `POST /api/runbooks/:id/restore` | `runbooks:write` | Un-archives; 409 `RUNBOOK_NAME_TAKEN` if a live runbook has the name now |
| `GET /api/runbooks/:id/versions` | `runbooks:read` | History, newest first, without definitions |
| `GET /api/runbooks/:id/versions/:version` | `runbooks:read` | One version with its definition |
| `POST /api/runbooks/validate` | `runbooks:write` | `{ definition }` returns `{ valid, definition (normalised), definitionSha256, warnings }`; nothing is saved |
| `POST /api/runbooks/targets/preview` | `runbooks:read` | `{ selector }` returns `{ servers: [{ id, name, hostname, tags, hostKeyTrusted, facts: { prettyName } }], skipped: [{ serverProfileId, reason }], total, capped, limit }` |

**Versions are immutable.** A definition change appends a version; nothing updates or deletes one. Names are unique among live (non-archived) runbooks of an organization, case-insensitively.

**Definition.** `{ schemaVersion: 1, parameters[], steps[1..50], defaultTargets, strategy }`; step kinds `command`, `script`, `package_update`, `file_upload`, `collect_logs`, `ai_task`, `approval_gate`. The schema is `apps/api/src/runbooks/schema/runbook-definition.schema.ts` (types: `RunbookDefinition`, `RunbookStep`, `RunbookParameter`, `TargetSelector`, `RunStrategy`). Parameters reach commands only as environment variables; there is no template substitution into command text. `allow`, `deny` and parameter `pattern` values are RE2 expressions. A definition that fails answers `422 RUNBOOK_DEFINITION_INVALID` with `details.issues: [{ path, code, message }]`, `path` being the JSON path into the definition.

**Target resolution.** The selector is the union of `serverIds` and the servers whose tags match (`any` = overlap, `all` = contains; both given means both must hold), minus `exclude`. Servers the caller may `connect` to (their own, one owned by a group of theirs, one shared with them as `operator` or better; #71) are targets, sorted by `name, id` and capped at the organization's effective `runbooks.maxTargetsPerRun` (`total` is the count before the cap, `capped` says it was cut). A server NAMED by id that the caller cannot connect to is listed in `skipped` with `reason: "forbidden"`, and a named id that does not exist in the organization with `"not_found"`; a server matched only by TAG is considered only when the caller may read it, so a tag never reveals another user's private server. `groupIds` (groups of servers, not user groups) still answers `422 RUNBOOK_TARGET_GROUPS_UNAVAILABLE`.

**Secret parameters.** `GET /api/runbook-secrets`, `PUT /api/runbook-secrets/:name` (`{ value, label? }`) and `DELETE /api/runbook-secrets/:name` (all `runbooks:write`; `name` matches `^[a-z][a-z0-9_-]{0,63}$`) manage the organization's `runbook_secret` credentials. Values are write-only: responses carry `name`, `label`, `hint` (masked, at most the last four characters), `createdAt`, `updatedAt` and `updatedBy`, never the value. A run names the credential for a `secret` parameter (`secretRefs`); the value never appears in a definition, a run row or a job payload.

**Audit events** (`audit_events`): `runbook.created`, `runbook.version_created` (with `definition_sha256`), `runbook.archived`, `runbook.restored`, `runbook_secret.set`, `runbook_secret.deleted`.

**Settings.** The `runbooks` system namespace (`enabled`, `maxTargetsPerRun` 200, `maxConcurrency` 20, `defaultStepTimeoutSec` 600, `maxLogBytesPerStep` 5 MiB, `approvals.allowSelfApproval` false, `approvals.defaultExpirySec` 86400, `ai.agentEnabled` true) can be tightened, never loosened, per organization through `/api/org-settings`.

### Sharing: groups, shared servers and shared runbooks

Server profiles and runbooks are private to their owner until shared (#71). The sharing slice (`@marinoscar/platform-api/sharing`) provides the routes; ShellKeep registers two resource types, `server_profile` and `runbook`, and every decision is `AccessPolicy`'s. A record the caller may not see is **404, never 403**, so existence is never disclosed; a missing RBAC permission (for example `sessions:write` to connect) is a 403 naming it. A grant carries a **role, never a credential**.

| Route | Permission | Notes |
|---|---|---|
| `GET /api/groups`, `POST /api/groups`, `GET`/`PATCH`/`DELETE /api/groups/:id` | `groups:read`, `groups:write` | Groups of the active organization. `DELETE` answers `409` with `details.reason: "GROUP_OWNS_RESOURCES"` and `details.counts` while the group owns a server profile or a runbook |
| `GET`/`POST /api/groups/:id/members`, `PATCH`/`DELETE /api/groups/:id/members/:userId`, `GET`/`POST /api/groups/:id/invites`, `GET /api/groups/invites/mine` | `groups:read`, `groups:write` | Group roles `admin`, `editor`, `viewer` |
| `GET /api/grants?resourceType&resourceId`, `POST /api/grants`, `PATCH`/`DELETE /api/grants/:id` | `sharing:read`, `sharing:write` | Share one record with a user (`{ kind: "user", userId }` or `email`) or a group (`{ kind: "group", groupId }`) with a role; needs the `share` action on the record (its owner) |
| `GET /api/grants/shared-with-me` | `sharing:read` | Active grants to the caller or their groups |
| `POST /api/grants/links` | `sharing:write` | **Always `422` with `details.reason: "ROLE_NOT_GRANTABLE"`** for both types: links are off |

**Server profile roles** (`owner` is implicit): `viewer` reads the profile (never a credential); `operator` also tests the connection, opens sessions and runs runbooks on it; `editor` also changes the name, tags, color and host-key trust. A member of the owning group holds `admin` as `editor`, `editor` as `operator`, `viewer` as `viewer`. `share` and `delete` need `owner`. Each action also needs its RBAC permission, even for the owner: `connect` needs `sessions:write`, `run` needs `runbooks:run`, `write` needs `servers:write`, `delete` needs `servers:delete`.

**Runbook roles**: `viewer` reads (and previews targets), `runner` also runs, `editor` also saves versions, edits metadata and archives. The group mapping is `admin` as `editor`, `editor` as `runner`, `viewer` as `viewer`; `share` needs `owner`; `run` needs `runbooks:run`, `write` needs `runbooks:write`.

**Server profiles.**
- `GET /api/server-profiles` lists what the caller may see; `?filter=mine|shared|all`. `POST /api/server-profiles` and `POST /api/runbooks` accept `ownerGroupId` (the caller must be an `admin` or `editor` of that group, `403 GROUP_ROLE_INSUFFICIENT` for a viewer, `404` for a group they are not in).
- Every item carries `owner` (`{ kind: "user" | "group", id, name }`) and `access` (`{ role, via, shared, credentialHolder, can: { connect, test, write, share, delete } }`; a runbook's `can` is `{ run, write, share }`). The `has*` credential flags are returned **only to the user who saved the credentials**; a grantee gets none of them.
- The SSH secrets stay in the credential store of the user who saved them and are read server-side only, for `POST /api/server-profiles/:id/test`, the host-key and facts routes, the session history download and the terminal socket. A grantee's `PATCH` that changes the hostname, port, username, auth method or a secret answers `403 SERVER_PROFILE_CREDENTIAL_HOLDER_ONLY`, so a share can never redirect a stored credential to another host.
- Per route: `GET` needs `read` (viewer); `POST /:id/test`, `/host-key/scan` and `/facts/refresh` need `test` (operator); `PATCH`, `POST /:id/host-key/trust` and `DELETE /:id/host-key` need `write` (editor); `DELETE /:id` needs `delete` (owner). A grantee below the role gets 404.
- `POST /api/sessions` needs `connect` on the profile (404 otherwise); the session is the caller's own, so each person who connects opens their own tmux session. The terminal socket checks `connect` again on every attach: a revoked share answers `NOT_FOUND`.
- `DELETE /api/server-profiles/:id` (the owner) removes the grants on it in the same transaction.

**Audit events.** The slice audits shares, revocations and group membership. ShellKeep adds `server_profile.connect_as_grantee` (actor, profile id, `ownerUserId`, `ownerGroupId`, `purpose`: `connect`, `test`, `history` or `run`; never a secret) whenever a credential is read for a caller who did not save it. Metric: `app.sharing.access_decisions` (`resource_type`, `outcome`, `via`).

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
| `runbook-runs` | `runbooks:read` | `{ from, to, runbookId? }` | Run, target and step status, timings, exit codes and artifact object ids (the run tables arrive with #62; until then the file has no dataset). Log contents are never exported |

Formats: `json`, `csv` (a zip of one CSV per dataset) and `xlsx`. Audit: `export:create` after the job commits. Metrics: `app.exports`, `app.export.duration`, `app.export.size` (no user id label). Notifications: `export.ready` and `export.failed` (a fixed message).

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
| `RUNBOOK_NAME_TAKEN` | 409 | Another live runbook in the organization has this name |
| `RUNBOOK_ARCHIVED` | 409 | The runbook is archived; restore it before changing it |
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
