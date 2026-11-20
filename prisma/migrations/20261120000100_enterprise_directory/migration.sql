-- Add the nullable timestamps first. Rows from previous versions keep their unknown creation time.
ALTER TABLE qc_roles
  ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN version INT NOT NULL DEFAULT 1,
  ADD COLUMN createdAt DATETIME(3) NULL,
  ADD COLUMN deletedAt DATETIME(3) NULL;
ALTER TABLE qc_roles MODIFY createdAt DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3);

ALTER TABLE qc_accounts
  ADD COLUMN avatar MEDIUMTEXT NULL,
  ADD COLUMN phone VARCHAR(32) NOT NULL DEFAULT '',
  ADD COLUMN allowMultipleSessions BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN version INT NOT NULL DEFAULT 1,
  ADD COLUMN createdAt DATETIME(3) NULL,
  ADD COLUMN deletedAt DATETIME(3) NULL;
ALTER TABLE qc_accounts MODIFY createdAt DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE TABLE qc_directory_requests (
  actorId CHAR(36) NOT NULL,
  requestId CHAR(36) NOT NULL,
  fingerprint VARCHAR(191) NOT NULL,
  subjectId VARCHAR(48) NOT NULL,
  PRIMARY KEY (actorId, requestId)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
