// worker/src/lease.js

async function acquireJob(db, workerId, leaseDurationMs) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const res = await client.query(`
      SELECT *
      FROM jobs
      WHERE state = 'QUEUED'
        AND (lease_expiry IS NULL OR lease_expiry < NOW())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    if (res.rowCount === 0) {
      await client.query('COMMIT');
      return null;
    }

    const job = res.rows[0];
    const leaseExpiry = new Date(Date.now() + leaseDurationMs);

    await client.query(
      `
      UPDATE jobs
      SET state = 'RUNNING',
          lease_owner = $1,
          lease_expiry = $2
      WHERE id = $3
      `,
      [workerId, leaseExpiry, job.id]
    );

    await client.query('COMMIT');
    return job;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { acquireJob };
