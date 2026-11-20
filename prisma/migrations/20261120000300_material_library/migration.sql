-- CreateTable
CREATE TABLE `qc_storage_settings` (
    `id` VARCHAR(32) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `activeRevisionId` VARCHAR(36) NOT NULL,
    `providers` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_storage_revisions` (
    `id` VARCHAR(36) NOT NULL,
    `provider` VARCHAR(16) NOT NULL,
    `config` JSON NOT NULL,
    `secretsCipher` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_material_groups` (
    `id` VARCHAR(36) NOT NULL,
    `scopeKey` VARCHAR(64) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `qc_material_groups_scopeKey_kind_name_key`(`scopeKey`, `kind`, `name`),
    UNIQUE INDEX `qc_material_groups_scopeKey_kind_id_key`(`scopeKey`, `kind`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_materials` (
    `id` VARCHAR(36) NOT NULL,
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

    UNIQUE INDEX `qc_materials_objectKey_key`(`objectKey`),
    INDEX `qc_materials_scopeKey_kind_deletedAt_createdAt_idx`(`scopeKey`, `kind`, `deletedAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `qc_audit_events` (
    `id` VARCHAR(36) NOT NULL,
    `actor` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `details` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `qc_audit_events_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `qc_materials` ADD CONSTRAINT `qc_materials_scopeKey_kind_groupId_fkey` FOREIGN KEY (`scopeKey`, `kind`, `groupId`) REFERENCES `qc_material_groups`(`scopeKey`, `kind`, `id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
