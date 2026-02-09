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
