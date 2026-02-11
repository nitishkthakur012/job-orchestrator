// worker/src/worker.js

const { acquireJob } = require('./lease');

async function workerLoop(db, workerId) {
  const LEASE_MS = 30_000;

  while (true) {
    const job = await acquireJob(db, workerId, LEASE_MS);

    if (!job) {
      await sleep(1000); // backoff, not "hope"
      continue;
    }

    try {
      await executeJob(job);

      await db.query(
        `
        UPDATE jobs
        SET state = 'SUCCESS',
            lease_owner = NULL,
            lease_expiry = NULL
        WHERE id = $1
        `,
        [job.id]
      );
    } catch (err) {
      await db.query(
        `
        UPDATE jobs
        SET state = CASE
                      WHEN retry_count + 1 >= max_retries THEN 'DEAD'
                      ELSE 'QUEUED'
                    END,
            retry_count = retry_count + 1,
            lease_owner = NULL,
            lease_expiry = NULL
        WHERE id = $1
        `,
        [job.id]
      );
    }
  }
}
