-- CreateTable
CREATE TABLE `qc_consumers` (
    `scope` VARCHAR(100) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `memberNumber` VARCHAR(48) NOT NULL,
    `nickname` VARCHAR(64) NOT NULL,
    `avatar` MEDIUMTEXT NULL,
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `email` VARCHAR(254) NOT NULL DEFAULT '',
    `gender` VARCHAR(16) NOT NULL DEFAULT 'unknown',
    `passwordHash` VARCHAR(256) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `authVersion` INTEGER NOT NULL DEFAULT 1,
    `version` INTEGER NOT NULL DEFAULT 1,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `growth` INTEGER NOT NULL DEFAULT 0,
    `paidCents` BIGINT NOT NULL DEFAULT 0,
    `paidOrders` INTEGER NOT NULL DEFAULT 0,
    `memberLevelId` VARCHAR(36) NULL,

    INDEX `qc_consumers_listing`(`scope`, `deletedAt`, `lastActivityAt`),
    UNIQUE INDEX `qc_consumers_number`(`scope`, `memberNumber`),
    PRIMARY KEY (`scope`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_consumer_counters` (
    `scope` VARCHAR(100) NOT NULL,
    `nextNumber` INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (`scope`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_member_levels` (
    `scope` VARCHAR(100) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `rank` INTEGER NOT NULL,
    `upgradeMode` VARCHAR(8) NOT NULL DEFAULT 'all',
    `conditions` JSON NOT NULL,
    `benefits` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `qc_member_level_name`(`scope`, `name`),
    UNIQUE INDEX `qc_member_level_rank`(`scope`, `rank`),
    PRIMARY KEY (`scope`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_member_tags` (
    `scope` VARCHAR(100) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `qc_member_tag_name`(`scope`, `name`),
    PRIMARY KEY (`scope`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_consumer_tags` (
    `scope` VARCHAR(100) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `tagId` VARCHAR(36) NOT NULL,

    INDEX `qc_consumer_tag_lookup`(`scope`, `tagId`),
    PRIMARY KEY (`scope`, `userId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_member_rules` (
    `scope` VARCHAR(100) NOT NULL,
    `registrationGrowth` INTEGER NOT NULL DEFAULT 0,
    `purchaseGrowthPerYuan` INTEGER NOT NULL DEFAULT 0,
    `baseLevel` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`scope`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_consumer_growth` (
    `scope` VARCHAR(100) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `levelBefore` JSON NOT NULL,
    `levelAfter` JSON NOT NULL,
    `before` INTEGER NOT NULL,
    `after` INTEGER NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `qc_consumer_growth_listing`(`scope`, `userId`, `createdAt`),
    PRIMARY KEY (`scope`, `userId`, `requestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_consumer_wallets` (
    `scope` VARCHAR(100) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `asset` VARCHAR(16) NOT NULL,
    `amount` BIGINT NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`scope`, `userId`, `asset`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_consumer_wallet_entries` (
    `scope` VARCHAR(100) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `asset` VARCHAR(16) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `requestId` VARCHAR(128) NOT NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `delta` BIGINT NOT NULL,
    `beforeAmount` BIGINT NOT NULL,
    `afterAmount` BIGINT NOT NULL,
    `reference` VARCHAR(80) NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `qc_consumer_wallet_listing`(`scope`, `asset`, `createdAt`),
    UNIQUE INDEX `qc_consumer_wallet_request`(`scope`, `userId`, `asset`, `requestId`),
    PRIMARY KEY (`scope`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `qc_consumers` ADD CONSTRAINT `qc_consumers_scope_memberLevelId_fkey` FOREIGN KEY (`scope`, `memberLevelId`) REFERENCES `qc_member_levels`(`scope`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `qc_consumer_tags` ADD CONSTRAINT `qc_consumer_tags_scope_userId_fkey` FOREIGN KEY (`scope`, `userId`) REFERENCES `qc_consumers`(`scope`, `userId`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `qc_consumer_tags` ADD CONSTRAINT `qc_consumer_tags_scope_tagId_fkey` FOREIGN KEY (`scope`, `tagId`) REFERENCES `qc_member_tags`(`scope`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

