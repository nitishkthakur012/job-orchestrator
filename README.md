# Distributed Asynchronous Job Orchestration Platform

## Problem Statement

Long-running tasks such as email delivery, report generation, or batch processing cannot be reliably handled using a request–response API model. These tasks are prone to mid-execution failures caused by application timeouts, network interruptions, or server restarts.

In a synchronous request–response flow, the server begins processing immediately after receiving the request. If a failure occurs during execution, the user is left uncertain about what happened — whether the task completed, partially executed, or failed entirely. Retries further complicate the situation by potentially triggering duplicate work.

Asynchronous job execution addresses these issues by decoupling user intent from task execution. The system can acknowledge the request immediately and execute the work in the background, allowing failures to be handled transparently while providing users with a reliable way to track job progress and outcomes.

---

## Core Invariants (Non-Negotiable Rules)

1. **Database is the source of truth**  
   Job state must be persisted so that it survives application crashes, worker restarts, and redeployments.

2. **At-least-once execution**  
   Due to failures such as timeouts, network issues, or worker crashes, it is not feasible to guarantee exactly-once execution. Jobs may execute more than once, but must never be lost.

3. **Idempotency**  
   Jobs must be designed so that duplicate executions do not produce incorrect side effects or corrupt system state.

4. **Worker crash tolerance**  
   If a worker fails while processing a job, the system must be able to recover and retry the job using the persisted job state instead of restarting the entire process or losing progress.

---

## Non-Goals (Intentional Exclusions)

This system does not attempt to guarantee:
- Exactly-once execution
- Real-time completion guarantees
- Global ordering of jobs

## Job State Machine

The system models job execution using an explicit state machine.  
Each job exists in exactly one state at any time, and only predefined transitions are allowed.  
This makes job execution predictable, debuggable, and safe under failures.

---

## Job States

### CREATED
The job has been durably created and stored by the API, but is not yet eligible for execution.  
Only the API is allowed to move a job out of this state.

### QUEUED
The job is ready and eligible to be executed, but no worker currently owns it.  
Any worker may attempt to acquire ownership and move the job to RUNNING.

### RUNNING
The job is currently owned by exactly one worker, which has exclusive rights to execute and update it.  
Only the owning worker may move the job out of this state.

### SUCCESS
The job has completed successfully and all intended effects have been applied.  
This is a terminal state and the job must never be executed again.

### RETRY
The job previously failed but is considered recoverable and will be retried after a backoff period.  
The job is not executable in this state until it is re-queued.

### DEAD
The job has failed permanently after exhausting all retry attempts or encountering a fatal error.  
This is a terminal state and requires manual intervention if further action is needed.

---

## State Transition Table

Only the following state transitions are allowed.  
Any transition not listed here is illegal by design.

| From State | To State | Trigger |
|-----------|----------|---------|
| CREATED | QUEUED | API accepts job |
| QUEUED | RUNNING | Worker acquires ownership |
| RUNNING | SUCCESS | Owning worker completes job |
| RUNNING | RETRY | Recoverable failure |
| RETRY | QUEUED | Backoff period expires |
| RETRY | DEAD | Retry limit exceeded |

---

## Failure Handling Scenarios

### Worker crashes while RUNNING
Jobs are leased to workers using time-limited ownership.  
If a worker crashes or becomes unresponsive, its lease eventually expires, allowing the job to be safely recovered and retried without manual intervention.

### Two workers attempt to pick the same job
Workers do not directly pick jobs. Instead, they attempt an atomic state transition from QUEUED to RUNNING.  
The database enforces this transition, ensuring that only one worker can successfully acquire ownership.

### API crashes after creating a job
If the API crashes after persisting a job but before responding to the client, the job remains safely stored in the CREATED state.  
This prevents premature execution and allows the client to safely retry without risking duplicate or lost jobs.

---

## Data Model Rationale

The data model exists to enforce the job state machine and its failure guarantees.

### UUID primary key
Provides globally unique, coordination-free job identity suitable for distributed systems.

### state
Acts as the single source of truth for job lifecycle and enforces valid state transitions.

### retry_count
Tracks how many times a job has failed and enables deterministic transition from RETRY to DEAD.

### lease_expiry
Enforces time-limited ownership, preventing jobs from being permanently stuck if a worker crashes.

### timestamps (created_at, updated_at)
Required for debugging, retry backoff calculations, and reasoning about system behavior over time.


## API Contracts

This service exposes a control-plane API for creating and observing background jobs.  
The API records **intent only**. It **never executes jobs synchronously**.

The API is designed to be safe under retries, crashes, and duplicate requests.

### POST /jobs

Creates a new job intent in the system.

#### Purpose

This endpoint records the client’s intent to create a job.  
It does **not** execute the job. Execution happens **asynchronously** after the request returns.

#### Request

```json
{
  "jobType": "SEND_EMAIL",
  "payload": { 
    "to": "user@example.com",
    "subject": "Welcome",
    "...": "..."
  },
  "idempotencyKey": "req_550e8400-e29b-41d4-a716-446655440000"
}

```
- `jobType` identifies the type of work to be performed
- `payload` contains job-specific data required for execution
- `idempotencyKey` uniquely identifies this logical request and is generated by the client

#### 1️⃣ Behavior on Success (First Request)

When a request with a previously unseen `idempotencyKey` is received:

- The API records a new job in the database
- The job is persisted with status `PENDING`
- A unique `jobId` is generated

**Response:**

- HTTP Status: **202 Accepted**
- Body includes:
  - `jobId`
  - current job status

**Guarantees:**

- The job intent is durably recorded
- The job will be processed asynchronously
- The API does not execute the job as part of this request
- The API returns 202 Accepted because the request has been accepted for processing, but execution has not yet completed

#### 2️⃣ Behavior on Client Retry (same idempotencyKey)

Clients are expected to retry requests due to timeouts or network failures.

When the API receives a request with an `idempotencyKey` that already exists:

- No new job is created
- The existing job associated with that `idempotencyKey` is returned

**Response:**

- HTTP Status: **202 Accepted**
- Body includes:
  - the same `jobId` as the original request
  - current job status

**Guarantees:**

- Duplicate requests do not create duplicate jobs
- Retries are safe and idempotent
- Retry responses are indistinguishable from the original success response
- Retries are treated as normal behavior, not as errors

#### 3️⃣ Behavior on Server Crash (after DB insert, before response)

If the server crashes after successfully recording the job in the database but before sending a response:

- The job intent remains durably stored
- The client may retry the request with the same `idempotencyKey`

On retry:

- The API detects the existing job via the `idempotencyKey`
- The existing `jobId` is returned

**Guarantees:**

- Server crashes do not result in duplicate job creation
- The system remains consistent under crashes and retries
- The database is the single source of truth for job intent

#### Summary Guarantees for POST /jobs

- The API is **stateless**
- Job creation is **idempotent**
- The database enforces **uniqueness** of job intent
- The API **never executes** jobs
- The endpoint is safe under **retries**, **crashes**, and **concurrent requests**

### GET /jobs/{jobId}

Retrieves the current status of a previously created job.

#### Purpose

This endpoint allows clients to observe job state after submitting a job via `POST /jobs`.  
It is a **read-only** endpoint:

- It does not create jobs
- It does not execute jobs
- It does not mutate system state

Its only responsibility is to expose the durable truth stored in the database.

#### Request

```json

GET /jobs/{jobId}

```

- `jobId` is the identifier returned by `POST /jobs`.

#### Response (on success)

The API returns the current, externally visible state of the job.

Response includes:

- `jobId`
- `jobType`
- `status` (e.g. `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`)
- timestamps (e.g. `createdAt`, `updatedAt`)

These fields are sufficient for clients to:

- track progress
- detect completion or failure
- correlate job status with prior requests

#### Fields Never Exposed

The following are intentionally **not** returned:

- `payload`
- internal retry counters
- worker identifiers
- lease / lock metadata
- internal error stack traces
- infrastructure-specific details

**Rationale:**

- Payload may contain sensitive or large data
- Internal fields are unstable and subject to change
- The API contract exposes **outcomes**, not implementation details

#### Safety and Retry Behavior

This endpoint is **safe under retries**:

- Repeated requests do not create side effects
- Repeated requests always return the same job state for a given `jobId`
- Network retries, client retries, and duplicate requests are harmless

Because the endpoint is read-only, it is fully retryable and safe under all failure modes.

#### Behavior if Job Does Not Exist

If the specified `jobId` does not exist:

- The API returns an appropriate client error (e.g. **404 Not Found**)
- No state is created or modified

#### Summary Guarantees for GET /jobs/{jobId}

- The endpoint is **read-only**
- It is **safe under retries and failures**
- It exposes only stable, externally meaningful fields
- It reflects the **database** as the single source of truth
- It **never executes work** or mutates job state

## Database Support for Idempotency

Correct handling of retries and duplicate requests is enforced at the **database layer**.  
The database acts as the **single source of truth** for job intent and guarantees correctness under concurrency, retries, and crashes.

### Where the `idempotencyKey` Is Stored

The `idempotencyKey` is stored **with the job record itself**.

Each row in the `jobs` table represents a single logical job intent and includes:

- `jobId`
- `jobType`
- `payload`
- `idempotencyKey`
- job status and metadata

Storing the `idempotencyKey` alongside the job ensures that intent is:

- durable
- globally visible
- recoverable after crashes

### Why the `idempotencyKey` Must Be Unique

The database enforces a **unique constraint** on `idempotencyKey`.

This guarantees that:

- Only one job can exist for a given logical intent
- Concurrent requests cannot create duplicate jobs
- Retries are safe even when multiple API servers handle requests simultaneously

Uniqueness is enforced **atomically** by the database, ensuring correctness even under race conditions.

### What Breaks Without DB-Level Uniqueness

If uniqueness is **not** enforced at the database level:

- **Race conditions occur**  
  Concurrent requests may both create jobs before application-level checks detect duplication.

- **Retries become unsafe**  
  Client retries may create additional jobs instead of returning the original one.

- **Crashes cause duplication**  
  If the server crashes after inserting a job but before responding, a retry may create a second job.

- **Horizontal scaling breaks correctness**  
  Multiple API servers cannot reliably coordinate deduplication using in-memory or application-level logic.

In such cases, the system may appear correct in low-load or single-server environments but **fail under real production conditions**.

### Summary Guarantees

- Idempotency is enforced by the **database**, not application memory.
- Uniqueness constraints provide **atomic correctness** under concurrency.
- The system remains **safe under retries, crashes, and horizontal scaling**.
- All job intent can be **reconstructed** from durable database state.
