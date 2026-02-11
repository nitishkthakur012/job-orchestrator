// services/jobService.js
const db = require('../db');

async function createJob({ jobType, payload, idempotencyKey }) {
  try {
    // Attempt to record intent
    const result = await db.query(
      `
      INSERT INTO jobs (job_type, payload, idempotency_key, status)
      VALUES ($1, $2, $3, 'PENDING')
      RETURNING id, status
      `,
      [jobType, payload, idempotencyKey]
    );

    // New intent recorded
    return {
      jobId: result.rows[0].id,
      status: result.rows[0].status,
    };

  } catch (err) {
    // Unique constraint violation → retry / duplicate intent
    if (err.code === '23505') {
      const existing = await db.query(
        `
        SELECT id, status
        FROM jobs
        WHERE idempotency_key = $1
        `,
        [idempotencyKey]
      );

      return {
        jobId: existing.rows[0].id,
        status: existing.rows[0].status,
      };
    }

    // Anything else is a real error
    throw err;
  }
}

module.exports = {
  createJob,
};
