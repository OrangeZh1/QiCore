CREATE TABLE qc_consumer_sessions (
  digest CHAR(64) PRIMARY KEY, scope VARCHAR(100) NOT NULL, userId VARCHAR(64) NOT NULL,
  authVersion INT NOT NULL, expiresAt DATETIME(3) NOT NULL,
  INDEX qc_consumer_sessions_identity (scope,userId), INDEX qc_consumer_sessions_expiry (expiresAt)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_consumer_settings (
  scope VARCHAR(100) PRIMARY KEY, config JSON NOT NULL, version INT NOT NULL DEFAULT 1
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_consumer_auth_limits (
  `key` CHAR(64) PRIMARY KEY, count INT NOT NULL, expiresAt DATETIME(3) NOT NULL,
  INDEX qc_consumer_throttle_expiry (expiresAt)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_consumer_policy_acceptance (
  scope VARCHAR(100) NOT NULL, userId VARCHAR(64) NOT NULL, kind VARCHAR(16) NOT NULL, version INT NOT NULL,
  acceptedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (scope,userId,kind,version)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
