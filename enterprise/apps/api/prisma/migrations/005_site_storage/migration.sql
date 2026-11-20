CREATE TABLE `SiteStorageSetting` (
  `siteId` VARCHAR(64) NOT NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `activeRevisionId` VARCHAR(36) NULL,
  `providers` JSON NOT NULL,
  PRIMARY KEY (`siteId`),
  CONSTRAINT `SiteStorageSetting_siteId_fkey` FOREIGN KEY (`siteId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
