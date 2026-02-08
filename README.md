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
