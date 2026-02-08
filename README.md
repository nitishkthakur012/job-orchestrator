# Distributed Asynchronous Job Orchestration Platform

## Problem Statement
1) Why long-running tasks cannot be handled in req-res APIs?
    App time-out
    internet down
    server restart
    Due to above possible mid journey failure user can't able to decide    
    what went wrong during req-res APIs. User sends request and upon 
    receiving request servers starts related processing which can be 
    possibly terminated due to various possibilities which are unknown to 
    users which make a sense of unambiguity.
2) What goes wrong in synchronous execution?
    timeouts
    retries
    user uncertainty
    server restarts
3) Why background (async) execution is required?
    async mechanism run in background which user can see after server
    processing finished.

## Core Invariants (Non-negotiable Rules)
1) Database is the source of truth
    -> Job's state survive crashes and restarts 
2) At-least-once execution
    -> Its not possible to guarantee exactly once execution due to above 
    mentioned cases such as: App time out, internet down, server restart. 
    So job may execute more than once but must not be lost.
3) Idempotency
    -> Duplicate execution of job must not introduce any side effects 
    (errors)
4) Worker crash tolerance
    -> If a worker dies mid-job due to sudden issues, the system must 
    recover and retry using single source of truth i.e db instead of 
    restarting processing wasting resources.

## Non-Goals (Intentional Exclusions)
   this include "what this system does NOT try to guarantee":
   1) Exactly-once execution
   2) Real-time completion guarantees
   3) Global ordering of jobs