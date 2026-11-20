-- Add indexes for existing cleanup, recovery and tenant list queries.
-- Keep historical indexes and migration checksums unchanged.
CREATE INDEX `AdminSession_expiresAt_idx` ON `AdminSession`(`expiresAt`);
CREATE INDEX `AdminDelegation_expiresAt_idx` ON `AdminDelegation`(`expiresAt`);
CREATE INDEX `AdminDelegation_targetAdminId_idx` ON `AdminDelegation`(`targetAdminId`);
CREATE INDEX `Session_tenantId_applicationKey_userId_idx` ON `Session`(`tenantId`, `applicationKey`, `userId`);
CREATE INDEX `Session_expiresAt_idx` ON `Session`(`expiresAt`);
CREATE INDEX `RechargeOrder_scope_idx` ON `RechargeOrder`(`tenantId`, `applicationKey`, `createdAt`, `id`);
CREATE INDEX `PaymentRecord_pending_idx` ON `PaymentRecord`(`state`, `nextCheckAt`);
CREATE INDEX `PaymentRefund_pending_idx` ON `PaymentRefund`(`state`, `nextCheckAt`);
CREATE INDEX `PaymentNotice_pending_idx` ON `PaymentNotice`(`state`, `nextCheckAt`);
CREATE INDEX `PaymentNotice_payment_idx` ON `PaymentNotice`(`paymentId`, `state`);
CREATE INDEX `ConsumerProfile_listing_idx` ON `ConsumerProfile`(`tenantId`, `applicationKey`, `deletedAt`, `createdAt` DESC, `userId`);
