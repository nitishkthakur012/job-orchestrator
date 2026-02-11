// routes/jobs.js
const express = require('express');
const { createJob } = require('../services/jobService');

const router = express.Router();

router.post('/jobs', async (req, res, next) => {
  try {
    const { jobType, payload, idempotencyKey } = req.body;

    const result = await createJob({ jobType, payload, idempotencyKey });

    // Always return 202 — new request or retry
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
