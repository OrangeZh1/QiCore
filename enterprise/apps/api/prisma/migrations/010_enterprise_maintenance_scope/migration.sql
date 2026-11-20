-- Legacy platform schedules keep NULL and are never adopted or executed as enterprise jobs.
ALTER TABLE ScheduledTask ADD COLUMN enterpriseId VARCHAR(64) NULL,
  ADD INDEX ScheduledTask_enterprise_due (enterpriseId,enabled,nextRunAt);
