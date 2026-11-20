CREATE TABLE `qc_site_settings` (
    `id` VARCHAR(16) NOT NULL,
    `config` JSON NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
