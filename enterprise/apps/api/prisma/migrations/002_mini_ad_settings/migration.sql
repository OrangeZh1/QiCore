CREATE TABLE IF NOT EXISTS `TenantMiniAdSetting` (
  `tenantId` VARCHAR(64) NOT NULL,
  `applicationKey` VARCHAR(64) NOT NULL,
  `appId` VARCHAR(18) NOT NULL,
  `config` JSON NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
