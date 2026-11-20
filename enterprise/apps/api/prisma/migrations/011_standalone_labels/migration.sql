-- Update only the original built-in labels. Sites may have their own names and login copy.
START TRANSACTION;

UPDATE AdminAccount a
JOIN Tenant t ON t.ownerAdminId = a.id AND t.standaloneSlot = 1
SET a.nickname = '管理员', a.version = a.version + 1
WHERE BINARY a.nickname = '企业管理员';

UPDATE AdminRole SET name = '管理员', version = version + 1
WHERE portal = 'tenant' AND systemCode = 'tenant-admin' AND BINARY name IN ('企业管理员', '租户管理员');

UPDATE Tenant SET name = '我的站点', version = version + 1
WHERE standaloneSlot = 1 AND BINARY name = '本企业';

UPDATE SiteSetting SET config = JSON_SET(config, '$.tenant.loginTitle', '站点管理'), version = version + 1
WHERE id = 'platform' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(config, '$.tenant.loginTitle')) = CONCAT('租户运营管理', CHAR(10), '从这里开始。');

UPDATE SiteSetting SET config = JSON_SET(config, '$.tenant.loginDescription', '管理站点资源、成员和业务配置。'), version = version + 1
WHERE id = 'platform' AND BINARY JSON_UNQUOTE(JSON_EXTRACT(config, '$.tenant.loginDescription')) = '统一管理租户资源、成员和业务配置。';

COMMIT;
