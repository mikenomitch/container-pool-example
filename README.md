# Container Pool Management System

A Cloudflare Workers application that manages a pool of containerized applications for efficient resource allocation and load distribution across multiple global locations.

## Overview

This system maintains a pool of ready-to-use containers that can be instantly allocated to handle requests, eliminating cold start delays. It consists of:

- **PoolManager**: Durable Object that maintains the container pool and handles allocation
- **PoolContainer**: Durable Object that wraps individual containers with lifecycle management
- **Go Container App**: Simple HTTP server that runs inside each container
- **REST API**: HTTP endpoints for container management and proxying

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   REST API      │───▶│   PoolManager    │───▶│  PoolContainer  │
│ (Hono + OpenAPI)│    │ (Durable Object) │    │ (Durable Object)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                ▼                        ▼
                       ┌──────────────────┐    ┌─────────────────┐
                       │ SQLite Database  │    │  Go HTTP Server │
                       │ (Container State)│    │ (Port 8080)     │
                       └──────────────────┘    └─────────────────┘
```

### Key Components

**PoolManager** (`src/durable/pool-manager/index.ts`)

- Maintains a configurable pool of ready containers
- Allocates containers from pool or creates new ones on demand
- Tracks container lifecycle in SQLite database
- Uses alarms for automatic pool maintenance
- Handles orphaned container cleanup

**PoolContainer** (`src/durable/pool-container.ts`)

- Extends Cloudflare's Container class
- Manages individual container lifecycle (start, stop, destroy)
- Reports status back to PoolManager
- Handles container health monitoring
- Proxies HTTP requests to containerized application

**Go Container Application** (`container/main.go`)

- Simple HTTP server running on port 8080
- Serves content from `index.txt` file
- Admin endpoint (`/admin/update-text`) for content updates
- Returns container metadata headers

## Installation & Setup

### Prerequisites

- Node.js 18+
- Cloudflare Workers account with Containers enabled
- Wrangler CLI installed

### 1. Clone and Install Dependencies

```bash
git clone <repository-url>
cd container-pool
npm install
```

### 2. Configure Environment

The system uses environment variables defined in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "POOL_TARGET_INSTANCES": "30",    // Target number of ready containers
    "POOL_BATCH_SIZE": "10",          // Containers created per batch
    "POOL_BATCH_SPACING_IN_SECONDS": "10"  // Delay between batches
  }
}
```

### 3. Deploy to Cloudflare Workers

```bash
# Deploy to production
npm run deploy

# Run locally for development
npm run dev
```

### 4. Database Setup

The system automatically handles database migrations on first run. To manually generate migrations:

```bash
npm run db
```

## API Reference

⚠️ **Important**: The current implementation has no authentication. This is intended for development and testing purposes only.

### Get Container Instance

```http
POST /container
Content-Type: application/json

{
  "location": "wnam",              // Optional: CF location hint
  "maxLifetimeInSeconds": 3600     // Optional: max container lifetime
}
```

**Response:**

```json
{
  "id": "container-uuid-string"
}
```

**Supported Locations:**

- `wnam` - Western North America
- `enam` - Eastern North America
- `sam` - South America
- `weur` - Western Europe
- `eeur` - Eastern Europe
- `apac` - Asia Pacific
- `oc` - Oceania
- `afr` - Africa
- `me` - Middle East

### Interact with Container

```http
GET /container/{container-id}
POST /container/{container-id}
PUT /container/{container-id}
# Any HTTP method is supported
```

Requests are proxied directly to the container's Go application.

### Database Admin Interface

```http
GET /studio
```

Provides a web interface to browse the SQLite database containing container state.

### API Documentation

```http
GET /openapi
```

Returns OpenAPI 3.1 specification for the API.

## Usage Examples

### Basic Container Allocation

```bash
# Get a container instance
curl -X POST https://your-worker.your-subdomain.workers.dev/container \
  -H "Content-Type: application/json" \
  -d '{"location": "wnam"}'

# Response: {"id": "some-container-id"}

# Use the container
curl https://your-worker.your-subdomain.workers.dev/container/some-container-id
```

### Container with Custom Content

```bash
# Get container
CONTAINER_ID=$(curl -s -X POST https://your-worker.your-subdomain.workers.dev/container \
  -H "Content-Type: application/json" | jq -r .id)

# Update container content via admin endpoint
# Note: The Go app expects the admin path to not be proxied from outside
```

### Location-Specific Deployment

```bash
# Deploy container in Europe
curl -X POST https://your-worker.your-subdomain.workers.dev/container \
  -H "Content-Type: application/json" \
  -d '{"location": "weur", "maxLifetimeInSeconds": 1800}'
```

## Container Application

The containerized Go application (`container/main.go`) provides:

### Endpoints

- `GET /` - Returns content of `index.txt` or "No Content"
- `POST /admin/update-text` - Updates `index.txt` with request body

### Response Headers

All responses include container metadata:

- `X-Container-ID`: Deployment ID
- `X-Container-Country`: Country code
- `X-Container-Location`: Cloudflare location
- `X-Container-Region`: Cloudflare region

## Configuration

### Pool Settings

Adjust pool behavior via environment variables in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "POOL_TARGET_INSTANCES": "50",    // Increase pool size
    "POOL_BATCH_SIZE": "5",           // Smaller batch creation
    "POOL_BATCH_SPACING_IN_SECONDS": "15"  // Longer delays
  }
}
```

### Container Resources

Configure container resources in `wrangler.jsonc`:

```jsonc
{
  "containers": [{
    "configuration": {
      "vcpu": 0.25,        // CPU allocation
      "memory_mib": 256,   // Memory in MiB
      "disk": {"size_mb": 512}  // Disk space
    }
  }]
}
```

## Development

### Local Development

```bash
npm run dev
```

Starts local development server with hot reload.

### Testing

```bash
npm test
```

Runs the test suite using Vitest.

### Database Management

```bash
# Generate new migration
npm run db

# View database schema
cat src/durable/pool-manager/db/schema.ts
```

## Database Schema

The system uses SQLite to track container state:

```typescript
containers {
  id: string (primary key)      // Container UUID
  status: integer               // 0=POOL, 1=RELEASED
  startedAt: timestamp         // Container creation time
  releasedAt: timestamp        // When allocated to user
}
```
