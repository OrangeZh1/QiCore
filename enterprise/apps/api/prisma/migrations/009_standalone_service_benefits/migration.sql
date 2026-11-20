-- Additive single-enterprise service benefits, separate from wallet balances and application entitlements.
CREATE TABLE StandaloneBenefitCatalog (
  tenantId VARCHAR(64) NOT NULL, applicationKey VARCHAR(64) NOT NULL, config JSON NOT NULL, version INT NOT NULL DEFAULT 1,
  PRIMARY KEY (tenantId,applicationKey)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE StandaloneBenefitHolding (
  id CHAR(36) NOT NULL, tenantId VARCHAR(64) NOT NULL, applicationKey VARCHAR(64) NOT NULL,
  userId VARCHAR(64) NOT NULL, packageId CHAR(36) NOT NULL, packageName VARCHAR(64) NOT NULL,
  total INT NOT NULL, remaining INT NOT NULL, expiresAt DATETIME(3), version INT NOT NULL DEFAULT 1,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(tenantId,applicationKey,id),
  UNIQUE KEY StandaloneBenefit_holding_scope(tenantId,applicationKey,userId,id),
  KEY StandaloneBenefit_holding_time(tenantId,applicationKey,createdAt),
  CONSTRAINT StandaloneBenefit_consumer_fk FOREIGN KEY(tenantId,applicationKey,userId)
    REFERENCES ConsumerProfile(tenantId,applicationKey,userId) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT StandaloneBenefit_amount CHECK (total>0 AND remaining>=0 AND remaining<=total)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE StandaloneBenefitEntry (
  id CHAR(36) NOT NULL, tenantId VARCHAR(64) NOT NULL, applicationKey VARCHAR(64) NOT NULL,
  userId VARCHAR(64) NOT NULL, holdingId CHAR(36) NOT NULL, requestId CHAR(36) NOT NULL,
  payloadHash CHAR(64) NOT NULL, kind VARCHAR(12) NOT NULL, delta INT NOT NULL, afterAmount INT NOT NULL,
  holdingVersion INT NOT NULL, actor VARCHAR(64) NOT NULL, reason VARCHAR(200) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(tenantId,applicationKey,id),
  UNIQUE KEY StandaloneBenefit_request(tenantId,applicationKey,requestId),
  KEY StandaloneBenefit_entry_time(tenantId,applicationKey,createdAt),
  KEY StandaloneBenefit_holding_fk(tenantId,applicationKey,userId,holdingId),
  CONSTRAINT StandaloneBenefit_entry_fk FOREIGN KEY(tenantId,applicationKey,userId,holdingId)
    REFERENCES StandaloneBenefitHolding(tenantId,applicationKey,userId,id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT StandaloneBenefit_entry_amount CHECK (afterAmount>=0 AND ((kind='grant' AND delta>0) OR (kind='redeem' AND delta<0)))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
