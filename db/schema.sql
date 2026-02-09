CREATE TABLE jobs (
    id UUID PRIMARY KEY,
    state VARCHAR(16) NOT NULL,
    retry_count INT NOT NULL DEFAULT 0,
    lease_expiry TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_jobs_polling
ON jobs (state, lease_expiry);
