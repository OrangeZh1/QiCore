CREATE TABLE qc_help_categories (
  scope VARCHAR(100) NOT NULL, id CHAR(36) NOT NULL, name VARCHAR(80) NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0, enabled BOOLEAN NOT NULL DEFAULT TRUE, version INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL, deletedAt DATETIME(3),
  PRIMARY KEY (scope, id), INDEX qc_help_categories_listing (scope, deletedAt, enabled, sort)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_help_articles (
  scope VARCHAR(100) NOT NULL, id CHAR(36) NOT NULL, categoryId CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL, content MEDIUMTEXT NOT NULL, searchText MEDIUMTEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0, enabled BOOLEAN NOT NULL DEFAULT TRUE, version INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updatedAt DATETIME(3) NOT NULL, deletedAt DATETIME(3),
  PRIMARY KEY (scope, id), INDEX qc_help_articles_listing (scope, categoryId, deletedAt, enabled, sort),
  CONSTRAINT qc_help_articles_category_fk FOREIGN KEY (scope, categoryId) REFERENCES qc_help_categories(scope, id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_policy_revisions (
  scope VARCHAR(100) NOT NULL, kind VARCHAR(16) NOT NULL, version INTEGER NOT NULL, title VARCHAR(80) NOT NULL,
  content MEDIUMTEXT NOT NULL, publishedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (scope, kind, version)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_contact_settings (
  scope VARCHAR(100) NOT NULL, config JSON NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (scope)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_help_images (
  scope VARCHAR(100) NOT NULL, articleId CHAR(36) NOT NULL, materialId CHAR(36) NOT NULL,
  PRIMARY KEY (scope, articleId, materialId), INDEX qc_help_images_lookup (materialId),
  CONSTRAINT qc_help_images_article_fk FOREIGN KEY (scope, articleId) REFERENCES qc_help_articles(scope, id) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE qc_policy_images (
  scope VARCHAR(100) NOT NULL, kind VARCHAR(16) NOT NULL, version INTEGER NOT NULL, materialId CHAR(36) NOT NULL,
  PRIMARY KEY (scope, kind, version, materialId), INDEX qc_policy_images_lookup (materialId),
  CONSTRAINT qc_policy_images_revision_fk FOREIGN KEY (scope, kind, version) REFERENCES qc_policy_revisions(scope, kind, version) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
