# MCP Apache Superset

A minimal [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that connects LLM clients (Claude Code, Claude Desktop, Cursor, etc.) to a local or remote [Apache Superset](https://superset.apache.org/) instance.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Authentication](#authentication)
  - [Database Auth (Default)](#database-auth-default)
  - [SSO / OAuth2 / OIDC](#sso--oauth2--oidc)
  - [LDAP](#ldap)
  - [Access Token (Pre-authenticated)](#access-token-pre-authenticated)
- [Usage](#usage)
  - [Claude Code](#claude-code)
  - [Claude Desktop](#claude-desktop)
  - [Development Mode](#development-mode)
- [Available Tools](#available-tools)
- [Running Superset Locally](#running-superset-locally)
- [Architecture](#architecture)

---

## Features

- 12 tools covering charts, dashboards, datasets, databases, SQL execution, and query history
- Automatic authentication with token refresh on 401
- CSRF token handling for write operations
- Supports database auth, OAuth2/OIDC SSO, LDAP, and pre-authenticated access tokens
- Zero external dependencies beyond the MCP SDK and Zod

---

## Prerequisites

- **Node.js** >= 18
- **Apache Superset** running and accessible (local or remote)

---

## Installation

```bash
git clone <this-repo>
cd mcp-apache
npm install
npm run build
```

---

## Configuration

All configuration is done via environment variables:

| Variable | Default | Description |
|---|---|---|
| `SUPERSET_URL` | `http://localhost:8088` | Superset base URL |
| `SUPERSET_USERNAME` | `admin` | Username for database/LDAP auth |
| `SUPERSET_PASSWORD` | `admin` | Password for database/LDAP auth |
| `SUPERSET_ACCESS_TOKEN` | _(none)_ | Pre-authenticated JWT access token (skips login) |
| `SUPERSET_AUTH_PROVIDER` | `db` | Auth provider: `db`, `ldap`, `oauth`, or `token` |

Copy the example file to get started:

```bash
cp .env.example .env
```

---

## Authentication

The MCP server supports multiple authentication methods to match your Superset deployment.

### Database Auth (Default)

The simplest method. Superset stores users in its own metadata database.

```bash
SUPERSET_AUTH_PROVIDER=db
SUPERSET_USERNAME=admin
SUPERSET_PASSWORD=admin
```

The server calls `POST /api/v1/security/login` with provider `"db"` and receives a JWT access token.

---

### SSO / OAuth2 / OIDC

When Superset is configured with OAuth2 or OpenID Connect (Azure AD, Okta, Keycloak, Google, etc.), you cannot log in via the REST API directly because the flow requires a browser redirect. There are two approaches:

#### Option A: Use a pre-authenticated access token

This is the **recommended approach for MCP servers**. You obtain a token outside the MCP flow and pass it directly.

**Step 1:** Configure Superset for OAuth2/OIDC in `superset_config.py`:

```python
from flask_appbuilder.security.manager import AUTH_OAUTH

AUTH_TYPE = AUTH_OAUTH

OAUTH_PROVIDERS = [
    {
        "name": "keycloak",  # or "azure", "okta", "google", etc.
        "icon": "fa-key",
        "token_key": "access_token",
        "remote_app": {
            "client_id": "superset-client",
            "client_secret": "YOUR_CLIENT_SECRET",
            "server_metadata_url": "https://keycloak.example.com/realms/myrealm/.well-known/openid-configuration",
            "api_base_url": "https://keycloak.example.com/realms/myrealm/protocol/openid-connect",
            "access_token_url": "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token",
            "authorize_url": "https://keycloak.example.com/realms/myrealm/protocol/openid-connect/auth",
            "client_kwargs": {
                "scope": "openid email profile"
            },
        },
    }
]

# Map OAuth roles to Superset roles
AUTH_ROLES_MAPPING = {
    "superset_admin": ["Admin"],
    "superset_alpha": ["Alpha"],
    "superset_gamma": ["Gamma"],
}
AUTH_ROLES_SYNC_AT_LOGIN = True
```

**Step 2:** Obtain a token via OAuth2 Client Credentials or Resource Owner Password Grant (for service accounts):

```bash
# Client Credentials Grant (service-to-service, no user context)
curl -X POST https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=superset-client" \
  -d "client_secret=YOUR_CLIENT_SECRET"

# Resource Owner Password Grant (if enabled by your IdP)
curl -X POST https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token \
  -d "grant_type=password" \
  -d "client_id=superset-client" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "username=svc-mcp" \
  -d "password=SVC_PASSWORD" \
  -d "scope=openid"
```

**Step 3:** Pass the token to the MCP server:

```bash
SUPERSET_AUTH_PROVIDER=token
SUPERSET_ACCESS_TOKEN=eyJhbGciOiJSUzI1NiIs...
```

**Step 4 (optional):** Automate token refresh with a wrapper script:

```bash
#!/bin/bash
# refresh-and-run.sh
export SUPERSET_ACCESS_TOKEN=$(curl -s -X POST \
  https://keycloak.example.com/realms/myrealm/protocol/openid-connect/token \
  -d "grant_type=client_credentials" \
  -d "client_id=superset-client" \
  -d "client_secret=$OAUTH_CLIENT_SECRET" | jq -r '.access_token')

export SUPERSET_AUTH_PROVIDER=token
export SUPERSET_URL=http://localhost:8088
node /path/to/mcp-apache/dist/index.js
```

Then in your MCP config:

```json
{
  "mcpServers": {
    "superset": {
      "command": "/path/to/refresh-and-run.sh"
    }
  }
}
```

#### Option B: Use Superset's login endpoint with OAuth (limited)

Some Superset deployments expose the standard login endpoint even when OAuth is configured (as a fallback). In that case, you can still use database auth for the MCP server by creating a local service account:

```bash
# Create a local DB user in Superset even if OAuth is primary auth
superset fab create-admin \
  --username mcp-service \
  --firstname MCP \
  --lastname Service \
  --email mcp@internal \
  --password STRONG_PASSWORD
```

Then configure the MCP server with `SUPERSET_AUTH_PROVIDER=db` and the service account credentials.

---

### LDAP

When Superset uses LDAP authentication:

```python
# superset_config.py
from flask_appbuilder.security.manager import AUTH_LDAP

AUTH_TYPE = AUTH_LDAP
AUTH_LDAP_SERVER = "ldap://ldap.example.com"
AUTH_LDAP_USE_TLS = True
AUTH_LDAP_SEARCH = "ou=users,dc=example,dc=com"
AUTH_LDAP_UID_FIELD = "sAMAccountName"
AUTH_LDAP_BIND_USER = "CN=superset-svc,OU=ServiceAccounts,DC=example,DC=com"
AUTH_LDAP_BIND_PASSWORD = "BIND_PASSWORD"
```

The MCP server configuration:

```bash
SUPERSET_AUTH_PROVIDER=ldap
SUPERSET_USERNAME=your.ldap.user
SUPERSET_PASSWORD=your_ldap_password
```

Internally this calls the same `/api/v1/security/login` endpoint but with `provider: "ldap"`.

---

### Access Token (Pre-authenticated)

If you already have a valid Superset JWT (from any method), skip the login flow entirely:

```bash
SUPERSET_AUTH_PROVIDER=token
SUPERSET_ACCESS_TOKEN=eyJhbGciOiJIUzI1NiIs...
```

The server will use this token directly in the `Authorization: Bearer` header. **Note:** when the token expires, requests will fail with 401. Use the wrapper script approach above for automatic refresh.

---

## Usage

### Claude Code

Add to your project's `.claude/settings.json` or global `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "superset": {
      "command": "node",
      "args": ["C:/development/git/mcp-apache/dist/index.js"],
      "env": {
        "SUPERSET_URL": "http://localhost:8088",
        "SUPERSET_USERNAME": "admin",
        "SUPERSET_PASSWORD": "admin"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "superset": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-apache/dist/index.js"],
      "env": {
        "SUPERSET_URL": "http://localhost:8088",
        "SUPERSET_USERNAME": "admin",
        "SUPERSET_PASSWORD": "admin"
      }
    }
  }
}
```

### Development Mode

Run without compiling (uses `tsx`):

```bash
npm run dev
```

Or in your MCP config:

```json
{
  "mcpServers": {
    "superset": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-apache/src/index.ts"],
      "env": {
        "SUPERSET_URL": "http://localhost:8088",
        "SUPERSET_USERNAME": "admin",
        "SUPERSET_PASSWORD": "admin"
      }
    }
  }
}
```

---

## Available Tools

### Charts

| Tool | Parameters | Description |
|---|---|---|
| `list_charts` | `page?`, `page_size?` | List all charts with pagination |
| `get_chart` | `id` | Get chart metadata (type, datasource, params) |
| `get_chart_data` | `id` | Execute the chart's query and return result data |

### Dashboards

| Tool | Parameters | Description |
|---|---|---|
| `list_dashboards` | `page?`, `page_size?` | List all dashboards |
| `get_dashboard` | `id` | Get dashboard metadata and layout |

### Datasets

| Tool | Parameters | Description |
|---|---|---|
| `list_datasets` | `page?`, `page_size?` | List registered datasets (tables/views) |
| `get_dataset` | `id` | Get dataset schema, columns, and metrics |

### Databases

| Tool | Parameters | Description |
|---|---|---|
| `list_databases` | _(none)_ | List all configured database connections |
| `get_database` | `id` | Get connection details for a database |

### SQL Execution

| Tool | Parameters | Description |
|---|---|---|
| `execute_sql` | `database_id`, `sql`, `schema?` | Run an arbitrary SQL query via SQL Lab |
| `list_saved_queries` | `page?`, `page_size?` | List saved SQL Lab queries |
| `list_queries` | `page?`, `page_size?` | List recent query execution history |

---

## Running Superset Locally

### Docker (quickest)

```bash
docker run -d -p 8088:8088 --name superset apache/superset

# First-time initialization
docker exec -it superset superset fab create-admin \
  --username admin \
  --firstname Admin \
  --lastname Admin \
  --email admin@example.com \
  --password admin

docker exec -it superset superset db upgrade
docker exec -it superset superset init
```

Access at http://localhost:8088

### Docker Compose (full stack with examples)

```bash
git clone https://github.com/apache/superset.git
cd superset
docker compose -f docker-compose-non-dev.yml up -d
```

This starts Superset with Redis, PostgreSQL, and example dashboards pre-loaded.

---

## Architecture

```
┌─────────────────┐       stdio        ┌──────────────────────┐
│  LLM Client     │◄──────────────────►│  MCP Server          │
│  (Claude Code)  │   MCP Protocol     │  (this project)      │
└─────────────────┘                    └──────────┬───────────┘
                                                  │ HTTP/REST
                                                  ▼
                                       ┌──────────────────────┐
                                       │  Apache Superset     │
                                       │  /api/v1/*           │
                                       └──────────┬───────────┘
                                                  │
                                       ┌──────────▼───────────┐
                                       │  Data Sources        │
                                       │  (PostgreSQL, MySQL,  │
                                       │   BigQuery, etc.)    │
                                       └──────────────────────┘
```

**Auth flow:**
1. MCP server starts → calls `POST /api/v1/security/login` (or uses pre-configured token)
2. Receives JWT access token + fetches CSRF token
3. All subsequent API calls include `Authorization: Bearer <token>` + `X-CSRFToken`
4. On 401 response → automatic re-authentication and retry

---

## License

MIT
