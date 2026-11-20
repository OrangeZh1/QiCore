-- One atomic ALTER: multiple pre-existing enterprise rows fail the unique constraint.
-- The surviving enterprise keeps its original id and every foreign-key relationship.
ALTER TABLE Tenant
  ADD COLUMN standaloneSlot TINYINT NOT NULL DEFAULT 1,
  ADD UNIQUE INDEX Tenant_single_enterprise (standaloneSlot),
  ADD CONSTRAINT Tenant_standalone_slot CHECK (standaloneSlot = 1);
