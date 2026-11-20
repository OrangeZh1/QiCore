-- Existing objects stay protected until their owning application claims them.
ALTER TABLE `StorageObject`
  ADD COLUMN `applicationKey` VARCHAR(64) NULL,
  ADD COLUMN `retention` VARCHAR(16) NOT NULL DEFAULT 'legacy';

CREATE INDEX `StorageObject_retention_deletedAt_expiresAt_idx`
  ON `StorageObject`(`retention`, `deletedAt`, `expiresAt`);
