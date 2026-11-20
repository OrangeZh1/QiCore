-- Retain historical application data while allowing only one current binding per tenant.
-- Existing bindings remain current. No application key or related data is rewritten.
ALTER TABLE `TenantApplication`
  ADD COLUMN `activeSlot` TINYINT NULL DEFAULT 1,
  DROP INDEX `TenantApplication_single_app`,
  ADD UNIQUE INDEX `TenantApplication_single_app` (`tenantId`, `activeSlot`),
  ADD INDEX `TenantApplication_active_scope` (`applicationKey`, `activeSlot`),
  ADD CONSTRAINT `TenantApplication_active_slot` CHECK (`activeSlot` IS NULL OR `activeSlot` = 1);
