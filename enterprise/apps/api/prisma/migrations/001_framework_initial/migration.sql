-- CreateTable
CREATE TABLE `ScheduledTask` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `command` VARCHAR(64) NOT NULL,
    `params` VARCHAR(1000) NOT NULL,
    `rule` VARCHAR(100) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `remark` VARCHAR(200) NOT NULL DEFAULT '',
    `ownerId` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `running` BOOLEAN NOT NULL DEFAULT false,
    `nextRunAt` DATETIME(3) NOT NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastFinishedAt` DATETIME(3) NULL,
    `lastStatus` VARCHAR(16) NULL,
    `lastError` VARCHAR(200) NULL,
    `durationMs` INTEGER NULL,
    `maxDurationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScheduledTask_enabled_nextRunAt_idx`(`enabled`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tenant` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `contactName` VARCHAR(64) NOT NULL DEFAULT '',
    `contactPhone` VARCHAR(32) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NULL DEFAULT CURRENT_TIMESTAMP(3),
    `logo` MEDIUMTEXT NULL,
    `storageMode` VARCHAR(16) NOT NULL DEFAULT 'platform',
    `remark` VARCHAR(1000) NOT NULL DEFAULT '',
    `customDomain` VARCHAR(253) NULL,
    `expiresAt` DATETIME(3) NULL,
    `ownerAdminId` VARCHAR(64) NULL,

    UNIQUE INDEX `Tenant_customDomain_key`(`customDomain`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantApplication` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `expiresAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `config` JSON NOT NULL,
    `configVersion` INTEGER NOT NULL DEFAULT 1,

    INDEX `TenantApplication_applicationKey_enabled_expiresAt_idx`(`applicationKey`, `enabled`, `expiresAt`),
    UNIQUE INDEX `TenantApplication_single_app`(`tenantId`),
    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantDecoration` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `schemes` JSON NOT NULL,
    `groups` JSON NULL,
    `published` JSON NULL,
    `activeId` VARCHAR(36) NULL,
    `publishedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantPageSharing` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `page` VARCHAR(16) NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `config` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`, `page`, `channel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminProvisionRequest` (
    `actorId` VARCHAR(64) NOT NULL,
    `requestId` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `resultId` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`actorId`, `requestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformStorageSetting` (
    `id` VARCHAR(32) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `activeRevisionId` VARCHAR(36) NOT NULL,
    `providers` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SiteSetting` (
    `id` VARCHAR(32) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `config` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantSiteSetting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantSubscriptionSetting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `appId` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionConsent` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `targetId` VARCHAR(64) NOT NULL,
    `attempt` INTEGER NOT NULL,
    `appId` VARCHAR(64) NOT NULL,
    `settingsVersion` INTEGER NOT NULL,
    `choices` JSON NOT NULL,
    `configSnapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SubscriptionConsent_target_key`(`tenantId`, `applicationKey`, `targetId`, `attempt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionDelivery` (
    `id` VARCHAR(36) NOT NULL,
    `consentId` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `appId` VARCHAR(64) NOT NULL,
    `event` VARCHAR(64) NOT NULL,
    `targetId` VARCHAR(64) NOT NULL,
    `templateId` VARCHAR(128) NOT NULL,
    `payload` JSON NOT NULL,
    `settingsVersion` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `errorCode` VARCHAR(64) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `claimToken` VARCHAR(36) NULL,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SubscriptionDelivery_consentId_key`(`consentId`),
    INDEX `SubscriptionDelivery_scope_idx`(`tenantId`, `applicationKey`, `createdAt`),
    INDEX `SubscriptionDelivery_queue_idx`(`status`, `nextAttemptAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantSmsSetting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `secretsCipher` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantSmsDelivery` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `requestId` VARCHAR(36) NOT NULL,
    `actorId` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `purpose` VARCHAR(16) NOT NULL,
    `phoneHash` VARCHAR(64) NOT NULL,
    `phoneMasked` VARCHAR(20) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `settingsVersion` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `errorCode` VARCHAR(64) NULL,
    `receipt` VARCHAR(128) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TenantSmsDelivery_scope_idx`(`tenantId`, `applicationKey`, `createdAt`),
    INDEX `TenantSmsDelivery_recovery_idx`(`status`, `createdAt`),
    UNIQUE INDEX `TenantSmsDelivery_request_key`(`tenantId`, `applicationKey`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SiteAsset` (
    `id` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `mime` VARCHAR(32) NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sourceMaterialId` VARCHAR(36) NULL,

    UNIQUE INDEX `SiteAsset_sourceMaterialId_kind_key`(`sourceMaterialId`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MaterialGroup` (
    `id` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MaterialGroup_kind_name_key`(`kind`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Material` (
    `id` VARCHAR(36) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `hash` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `revisionId` VARCHAR(36) NULL,
    `objectKey` VARCHAR(256) NULL,
    `legacySiteAssetId` VARCHAR(36) NULL,
    `ownerId` VARCHAR(64) NOT NULL,
    `visibility` VARCHAR(16) NOT NULL,
    `groupId` VARCHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Material_objectKey_key`(`objectKey`),
    UNIQUE INDEX `Material_legacySiteAssetId_key`(`legacySiteAssetId`),
    INDEX `Material_kind_status_createdAt_idx`(`kind`, `status`, `createdAt`),
    INDEX `Material_ownerId_visibility_idx`(`ownerId`, `visibility`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorageRevision` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `config` JSON NOT NULL,
    `secretsCipher` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorageObject` (
    `id` VARCHAR(36) NOT NULL,
    `revisionId` VARCHAR(36) NOT NULL,
    `objectKey` VARCHAR(256) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,
    `deleteRetryAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `StorageObject_objectKey_key`(`objectKey`),
    INDEX `StorageObject_expiresAt_deletedAt_idx`(`expiresAt`, `deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminRole` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `portal` VARCHAR(16) NOT NULL,
    `permissions` JSON NOT NULL,
    `systemCode` VARCHAR(32) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AdminRole_systemCode_key`(`systemCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminAccount` (
    `id` VARCHAR(64) NOT NULL,
    `username` VARCHAR(32) NOT NULL,
    `nickname` VARCHAR(64) NOT NULL,
    `avatar` MEDIUMTEXT NULL,
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `allowMultipleSessions` BOOLEAN NOT NULL DEFAULT true,
    `deletedAt` DATETIME(3) NULL,
    `passwordHash` VARCHAR(256) NOT NULL,
    `roleId` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AdminAccount_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminTenantScope` (
    `adminId` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `permissionRoleId` VARCHAR(64) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (`adminId`, `tenantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantRole` (
    `id` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `name` VARCHAR(50) NOT NULL,
    `permissions` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TenantRole_tenantId_createdAt_idx`(`tenantId`, `createdAt`),
    UNIQUE INDEX `TenantRole_tenantId_name_key`(`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminSession` (
    `tokenHash` VARCHAR(64) NOT NULL,
    `csrfHash` VARCHAR(64) NOT NULL,
    `adminId` VARCHAR(64) NOT NULL,
    `portal` VARCHAR(16) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminSession_adminId_idx`(`adminId`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AdminDelegation` (
    `tokenHash` VARCHAR(64) NOT NULL,
    `parentTokenHash` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `targetAdminId` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AdminDelegation_parentTokenHash_idx`(`parentTokenHash`),
    PRIMARY KEY (`tokenHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `wechatSessionCipher` TEXT NULL,
    `authProvider` VARCHAR(16) NULL,
    `authAppId` VARCHAR(64) NULL,
    `token` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `role` VARCHAR(16) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `Session_tenantId_userId_idx`(`tenantId`, `userId`),
    PRIMARY KEY (`token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WalletAccount` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `asset` VARCHAR(16) NOT NULL,
    `amount` BIGINT NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `WalletAccount_scope_key`(`tenantId`, `applicationKey`, `userId`, `asset`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WalletLot` (
    `id` VARCHAR(36) NOT NULL,
    `accountId` VARCHAR(36) NOT NULL,
    `sourceKey` VARCHAR(160) NOT NULL,
    `sourceOrder` VARCHAR(64) NULL,
    `kind` VARCHAR(32) NOT NULL,
    `original` BIGINT NOT NULL,
    `remaining` BIGINT NOT NULL,
    `spent` BIGINT NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WalletLot_account_idx`(`accountId`, `createdAt`, `id`),
    INDEX `WalletLot_order_idx`(`sourceOrder`),
    UNIQUE INDEX `WalletLot_source_key`(`accountId`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WalletEntry` (
    `id` VARCHAR(36) NOT NULL,
    `accountId` VARCHAR(36) NOT NULL,
    `requestKey` VARCHAR(160) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `reference` VARCHAR(64) NOT NULL,
    `delta` BIGINT NOT NULL,
    `beforeAmount` BIGINT NOT NULL,
    `afterAmount` BIGINT NOT NULL,
    `parts` JSON NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WalletEntry_account_idx`(`accountId`, `createdAt`, `id`),
    UNIQUE INDEX `WalletEntry_request_key`(`accountId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RechargeSetting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `config` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RechargeOrder` (
    `id` VARCHAR(20) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `requestKey` VARCHAR(64) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `product` JSON NOT NULL,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'CNY',
    `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
    `consumerDeletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RechargeOrder_consumer_idx`(`tenantId`, `applicationKey`, `userId`, `createdAt`, `id`),
    UNIQUE INDEX `RechargeOrder_request_key`(`tenantId`, `applicationKey`, `userId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsumerAssetOperation` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `requestId` VARCHAR(36) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `assetType` VARCHAR(16) NOT NULL,
    `reference` VARCHAR(64) NULL,
    `delta` BIGINT NOT NULL,
    `beforeAmount` BIGINT NOT NULL,
    `afterAmount` BIGINT NOT NULL,
    `grantId` VARCHAR(64) NULL,
    `reason` VARCHAR(200) NOT NULL,
    `actorId` VARCHAR(64) NOT NULL,
    `actorName` VARCHAR(64) NOT NULL,
    `membershipBefore` JSON NOT NULL,
    `membershipAfter` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsumerAssetOperation_scope_idx`(`tenantId`, `applicationKey`, `userId`, `createdAt`),
    UNIQUE INDEX `ConsumerAssetOperation_request_key`(`tenantId`, `applicationKey`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentRecord` (
    `providerState` JSON NULL,
    `id` VARCHAR(32) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `orderId` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `revisionId` VARCHAR(36) NOT NULL,
    `payerCipher` TEXT NOT NULL,
    `amount` INTEGER NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `state` VARCHAR(24) NOT NULL,
    `transactionId` VARCHAR(64) NULL,
    `payerTotal` INTEGER NULL,
    `paidAt` DATETIME(3) NULL,
    `prepayId` VARCHAR(128) NULL,
    `signingHash` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `closeRequested` BOOLEAN NOT NULL DEFAULT false,
    `closeReason` VARCHAR(16) NULL,
    `currentSlot` INTEGER NULL DEFAULT 1,
    `sequence` INTEGER NOT NULL DEFAULT 1,
    `previousId` VARCHAR(32) NULL,
    `supersededAt` DATETIME(3) NULL,
    `leaseToken` VARCHAR(36) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `nextCheckAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentRecord_transactionId_key`(`transactionId`),
    UNIQUE INDEX `PaymentRecord_previousId_key`(`previousId`),
    INDEX `PaymentRecord_recovery_idx`(`nextCheckAt`, `state`),
    UNIQUE INDEX `PaymentRecord_order_key`(`tenantId`, `applicationKey`, `orderId`, `currentSlot`),
    UNIQUE INDEX `PaymentRecord_sequence_key`(`tenantId`, `applicationKey`, `orderId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentRefund` (
    `providerState` JSON NULL,
    `amount` INTEGER NULL,
    `id` VARCHAR(32) NOT NULL,
    `paymentId` VARCHAR(32) NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT 1,
    `previousId` VARCHAR(32) NULL,
    `requestKey` VARCHAR(64) NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'admin',
    `reviewReason` VARCHAR(200) NULL,
    `reviewedBy` VARCHAR(64) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reason` VARCHAR(200) NOT NULL,
    `state` VARCHAR(24) NOT NULL,
    `refundId` VARCHAR(64) NULL,
    `payerRefund` INTEGER NULL,
    `succeededAt` DATETIME(3) NULL,
    `leaseToken` VARCHAR(36) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `nextCheckAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `lastError` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PaymentRefund_previousId_key`(`previousId`),
    UNIQUE INDEX `PaymentRefund_refundId_key`(`refundId`),
    INDEX `PaymentRefund_recovery_idx`(`nextCheckAt`, `state`),
    UNIQUE INDEX `PaymentRefund_sequence_key`(`paymentId`, `sequence`),
    UNIQUE INDEX `PaymentRefund_request_key`(`paymentId`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentNotice` (
    `id` VARCHAR(64) NOT NULL,
    `paymentId` VARCHAR(32) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `payloadCipher` TEXT NOT NULL,
    `state` VARCHAR(16) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextCheckAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastError` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PaymentNotice_recovery_idx`(`nextCheckAt`, `state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VirtualGoods` (
    `id` VARCHAR(32) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `appId` VARCHAR(64) NOT NULL,
    `offerId` VARCHAR(32) NOT NULL,
    `env` INTEGER NOT NULL,
    `localId` VARCHAR(64) NOT NULL,
    `productId` VARCHAR(20) NOT NULL,
    `snapshotHash` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `uploadState` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `publishState` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(300) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VirtualGoods_scope_idx`(`tenantId`, `applicationKey`, `appId`, `env`),
    UNIQUE INDEX `VirtualGoods_remote_key`(`appId`, `env`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VirtualGoodsTask` (
    `id` VARCHAR(64) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `operationId` VARCHAR(36) NOT NULL,
    `revisionId` VARCHAR(36) NOT NULL,
    `miniVersion` INTEGER NOT NULL,
    `action` VARCHAR(16) NOT NULL,
    `itemIds` JSON NOT NULL,
    `cursor` INTEGER NOT NULL DEFAULT 0,
    `stage` VARCHAR(16) NOT NULL DEFAULT 'START',
    `state` VARCHAR(16) NOT NULL,
    `message` VARCHAR(300) NOT NULL DEFAULT '',
    `leaseToken` VARCHAR(36) NULL,
    `leaseUntil` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VirtualGoodsSetting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `localId` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`, `localId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Audit` (
    `id` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NULL,
    `scope` VARCHAR(16) NOT NULL DEFAULT 'tenant',
    `tenantId` VARCHAR(64) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `details` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Audit_scope_createdAt_id_idx`(`scope`, `createdAt`, `id`),
    INDEX `Audit_scope_action_createdAt_idx`(`scope`, `action`, `createdAt`),
    INDEX `Audit_scope_actor_createdAt_idx`(`scope`, `actor`, `createdAt`),
    INDEX `Audit_scope_tenantId_applicationKey_createdAt_idx`(`scope`, `tenantId`, `applicationKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantMaterialGroup` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `scopeKey` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TenantMaterialGroup_tenantId_scopeKey_kind_name_key`(`tenantId`, `scopeKey`, `kind`, `name`),
    UNIQUE INDEX `TenantMaterialGroup_tenantId_scopeKey_kind_id_key`(`tenantId`, `scopeKey`, `kind`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantMaterial` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `scopeKey` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `bytes` INTEGER NOT NULL,
    `hash` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `revisionId` VARCHAR(36) NOT NULL,
    `objectKey` VARCHAR(256) NOT NULL,
    `ownerId` VARCHAR(64) NOT NULL,
    `groupId` VARCHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `TenantMaterial_objectKey_key`(`objectKey`),
    INDEX `TenantMaterial_tenantId_scopeKey_kind_deletedAt_createdAt_idx`(`tenantId`, `scopeKey`, `kind`, `deletedAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantConsumerSetting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `nextNumber` INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsumerProfile` (
    `growth` INTEGER NOT NULL DEFAULT 0,
    `memberLevelId` VARCHAR(36) NULL,
    `memberNumber` VARCHAR(32) NULL,
    `phone` VARCHAR(32) NOT NULL DEFAULT '',
    `email` VARCHAR(254) NOT NULL DEFAULT '',
    `gender` VARCHAR(16) NOT NULL DEFAULT 'unknown',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `passwordHash` VARCHAR(256) NULL,
    `deletedAt` DATETIME(3) NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `nickname` VARCHAR(64) NOT NULL,
    `avatar` MEDIUMTEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ConsumerProfile_member_number_key`(`tenantId`, `applicationKey`, `memberNumber`),
    PRIMARY KEY (`tenantId`, `applicationKey`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberLevel` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `systemKey` VARCHAR(16) NULL,
    `benefits` JSON NULL,
    `threshold` INTEGER NOT NULL,
    `rank` INTEGER NOT NULL,
    `upgradeMode` VARCHAR(8) NOT NULL DEFAULT 'all',
    `conditions` JSON NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MemberLevel_tenantId_applicationKey_name_key`(`tenantId`, `applicationKey`, `name`),
    UNIQUE INDEX `MemberLevel_tenantId_applicationKey_rank_key`(`tenantId`, `applicationKey`, `rank`),
    UNIQUE INDEX `MemberLevel_tenantId_applicationKey_systemKey_key`(`tenantId`, `applicationKey`, `systemKey`),
    PRIMARY KEY (`tenantId`, `applicationKey`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberTag` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `description` VARCHAR(200) NOT NULL DEFAULT '',
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MemberTag_tenantId_applicationKey_name_key`(`tenantId`, `applicationKey`, `name`),
    PRIMARY KEY (`tenantId`, `applicationKey`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsumerTag` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `tagId` VARCHAR(36) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`, `userId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberRule` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `registrationGrowth` INTEGER NOT NULL DEFAULT 0,
    `purchaseGrowthPerYuan` INTEGER NOT NULL DEFAULT 0,
    `baseLevel` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberPurchaseGrowth` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `orderId` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `perYuan` INTEGER NOT NULL,
    `multiplierBps` INTEGER NOT NULL DEFAULT 10000,
    `paidCents` BIGINT NOT NULL,
    `earned` INTEGER NOT NULL,
    `refundedCents` BIGINT NOT NULL DEFAULT 0,
    `returned` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`tenantId`, `applicationKey`, `orderId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MemberGrowthRecord` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `payloadHash` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(24) NOT NULL,
    `before` INTEGER NOT NULL,
    `after` INTEGER NOT NULL,
    `levelBefore` JSON NOT NULL,
    `levelAfter` JSON NOT NULL,
    `reason` VARCHAR(200) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MemberGrowthRecord_tenantId_applicationKey_userId_createdAt_idx`(`tenantId`, `applicationKey`, `userId`, `createdAt`),
    PRIMARY KEY (`tenantId`, `applicationKey`, `userId`, `requestId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantH5Setting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `displayName` VARCHAR(64) NOT NULL,
    `entryUrl` VARCHAR(1000) NOT NULL,
    `favicon` MEDIUMTEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantPaymentRevision` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `version` INTEGER NOT NULL,
    `config` JSON NOT NULL,
    `secretFields` JSON NOT NULL,
    `secretsCipher` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TenantPaymentRevision_scope_version_key`(`tenantId`, `applicationKey`, `provider`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantPaymentPolicy` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantOfficialAccountSetting` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `keyCipher` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantPolicyDocument` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `title` VARCHAR(80) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `currentVersion` INTEGER NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`, `kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HelpCategory` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `HelpCategory_listing`(`tenantId`, `applicationKey`, `deletedAt`, `enabled`, `sort`),
    PRIMARY KEY (`tenantId`, `applicationKey`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HelpArticle` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `id` VARCHAR(36) NOT NULL,
    `categoryId` VARCHAR(36) NOT NULL,
    `title` VARCHAR(120) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `searchText` MEDIUMTEXT NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `HelpArticle_listing`(`tenantId`, `applicationKey`, `categoryId`, `deletedAt`, `enabled`, `sort`),
    PRIMARY KEY (`tenantId`, `applicationKey`, `id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OfficialAccountTask` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `requestKey` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `settingsVersion` INTEGER NOT NULL,
    `appId` VARCHAR(32) NOT NULL,
    `payload` JSON NOT NULL,
    `recipientCipher` TEXT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `errorCode` VARCHAR(64) NULL,
    `claimToken` VARCHAR(36) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `OfficialAccountTask_pending_idx`(`status`, `createdAt`),
    UNIQUE INDEX `OfficialAccountTask_request_key`(`tenantId`, `applicationKey`, `requestKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantPolicyRevision` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `version` INTEGER NOT NULL,
    `title` VARCHAR(80) NOT NULL,
    `content` MEDIUMTEXT NOT NULL,
    `publishedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`, `kind`, `version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantMiniProgramSetting` (
    `uploadKeyCipher` TEXT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `config` JSON NOT NULL,
    `keyCipher` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`tenantId`, `applicationKey`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantMiniUploadTask` (
    `id` VARCHAR(36) NOT NULL,
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,
    `selection` JSON NOT NULL,
    `payload` JSON NOT NULL,
    `settingsVersion` INTEGER NOT NULL,
    `jobId` VARCHAR(191) NULL,
    `status` VARCHAR(16) NOT NULL,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `message` VARCHAR(300) NOT NULL DEFAULT '',
    `qrCode` MEDIUMTEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `attemptedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TenantMiniUploadTask_scope_idx`(`tenantId`, `applicationKey`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ConsumerExternalIdentity` (
    `tenantId` VARCHAR(64) NOT NULL,
    `applicationKey` VARCHAR(64) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `appId` VARCHAR(64) NOT NULL,
    `subjectHash` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(64) NOT NULL,
    `identityCipher` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ConsumerExternalIdentity_user_idx`(`tenantId`, `applicationKey`, `userId`),
    PRIMARY KEY (`tenantId`, `applicationKey`, `provider`, `appId`, `subjectHash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `TenantApplication` ADD CONSTRAINT `TenantApplication_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantDecoration` ADD CONSTRAINT `TenantDecoration_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantPageSharing` ADD CONSTRAINT `TenantPageSharing_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantSiteSetting` ADD CONSTRAINT `TenantSiteSetting_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Material` ADD CONSTRAINT `Material_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `MaterialGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminAccount` ADD CONSTRAINT `AdminAccount_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `AdminRole`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminTenantScope` ADD CONSTRAINT `AdminTenantScope_permissionRoleId_fkey` FOREIGN KEY (`permissionRoleId`) REFERENCES `TenantRole`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminTenantScope` ADD CONSTRAINT `AdminTenantScope_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `AdminAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminTenantScope` ADD CONSTRAINT `AdminTenantScope_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantRole` ADD CONSTRAINT `TenantRole_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminSession` ADD CONSTRAINT `AdminSession_adminId_fkey` FOREIGN KEY (`adminId`) REFERENCES `AdminAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AdminDelegation` ADD CONSTRAINT `AdminDelegation_parentTokenHash_fkey` FOREIGN KEY (`parentTokenHash`) REFERENCES `AdminSession`(`tokenHash`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PaymentRefund` ADD CONSTRAINT `PaymentRefund_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `PaymentRecord`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantMaterial` ADD CONSTRAINT `TenantMaterial_tenantId_scopeKey_kind_groupId_fkey` FOREIGN KEY (`tenantId`, `scopeKey`, `kind`, `groupId`) REFERENCES `TenantMaterialGroup`(`tenantId`, `scopeKey`, `kind`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `TenantConsumerSetting` ADD CONSTRAINT `TenantConsumerSetting_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumerProfile` ADD CONSTRAINT `ConsumerProfile_tenantId_applicationKey_memberLevelId_fkey` FOREIGN KEY (`tenantId`, `applicationKey`, `memberLevelId`) REFERENCES `MemberLevel`(`tenantId`, `applicationKey`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberLevel` ADD CONSTRAINT `MemberLevel_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberTag` ADD CONSTRAINT `MemberTag_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumerTag` ADD CONSTRAINT `ConsumerTag_tenantId_applicationKey_userId_fkey` FOREIGN KEY (`tenantId`, `applicationKey`, `userId`) REFERENCES `ConsumerProfile`(`tenantId`, `applicationKey`, `userId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ConsumerTag` ADD CONSTRAINT `ConsumerTag_tenantId_applicationKey_tagId_fkey` FOREIGN KEY (`tenantId`, `applicationKey`, `tagId`) REFERENCES `MemberTag`(`tenantId`, `applicationKey`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberRule` ADD CONSTRAINT `MemberRule_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberPurchaseGrowth` ADD CONSTRAINT `MemberPurchaseGrowth_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MemberGrowthRecord` ADD CONSTRAINT `MemberGrowthRecord_tenantId_applicationKey_userId_fkey` FOREIGN KEY (`tenantId`, `applicationKey`, `userId`) REFERENCES `ConsumerProfile`(`tenantId`, `applicationKey`, `userId`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TenantH5Setting` ADD CONSTRAINT `TenantH5Setting_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HelpCategory` ADD CONSTRAINT `HelpCategory_tenantId_applicationKey_fkey` FOREIGN KEY (`tenantId`, `applicationKey`) REFERENCES `TenantApplication`(`tenantId`, `applicationKey`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HelpArticle` ADD CONSTRAINT `HelpArticle_tenantId_applicationKey_categoryId_fkey` FOREIGN KEY (`tenantId`, `applicationKey`, `categoryId`) REFERENCES `HelpCategory`(`tenantId`, `applicationKey`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
