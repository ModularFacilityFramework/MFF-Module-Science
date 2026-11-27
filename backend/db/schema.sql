-- This module's own tables. No migrations, ever - this file is the single
-- source of truth for this module's schema, edited directly (same rule as
-- mff-core's own App_backend/install/schema.sql). Every table MUST be
-- prefixed with module.manifest.json's tablePrefix ("science_").
--
-- Imported by mff-core's own moduleDatabaseProvisioner.js, against this
-- module's own dedicated database (mff_module_<id>) created for it at
-- Install/Update time - see docs/MFF-Core_module-database-provisioning.md.
--
-- No FK to core's setup_users / setup_groups anywhere below on purpose: those
-- tables live in core's own database, not in this module's. User and group ids
-- are plain BIGINTs, resolved through coreApi.listUsers() / listGroups().

-- A project: the unit other modules run their jobs in. One owner (who can hand
-- it over). Access control is at the application level only: see
-- backend/services/access.js. folder_path is where modules write job output;
-- it is only a stored path, this module neither creates the folder nor sets
-- any file permission on it.
CREATE TABLE IF NOT EXISTS science_projects (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(20) NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  owner_user_id BIGINT NOT NULL,
  folder_path VARCHAR(1024) NULL,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  -- Shared with every signed-in user at this level; NULL = not. Only the
  -- Project template offers it.
  everyone_access ENUM('read','write') NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_number (number),
  KEY idx_owner (owner_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The one "Project template" project (backend/services/template.js). The single
-- slot makes its creation happen once.
CREATE TABLE IF NOT EXISTS science_template (
  slot TINYINT NOT NULL PRIMARY KEY,
  project_id BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_science_template_project FOREIGN KEY (project_id) REFERENCES science_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Who a project is shared with: a user or a whole group, read or write.
-- Grants add up: the highest one wins (read as a person + write through a
-- group = write). The owner needs no row; administrators and developers
-- always have full access.
CREATE TABLE IF NOT EXISTS science_project_members (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  member_type ENUM('user','group') NOT NULL,
  member_id BIGINT NOT NULL,
  access ENUM('read','write') NOT NULL DEFAULT 'read',
  added_by BIGINT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_member (project_id, member_type, member_id),
  KEY idx_member (member_type, member_id),
  CONSTRAINT fk_science_members_project FOREIGN KEY (project_id) REFERENCES science_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Research materials: proteins, complexes (e.g. ribosomes) and ligands. Each
-- record has one owner and is private or public. Public: other users can find
-- it and link it into their own projects. Private: only usable in projects
-- owned by its owner (others create their own record).
CREATE TABLE IF NOT EXISTS science_materials (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('protein','complex','ligand') NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  sequence MEDIUMTEXT NULL,
  uniprot_id VARCHAR(40) NULL,
  smiles TEXT NULL,
  owner_user_id BIGINT NOT NULL,
  visibility ENUM('private','public') NOT NULL DEFAULT 'private',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_owner (owner_user_id),
  KEY idx_kind_visibility (kind, visibility)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A material added to a project (one record can be in many projects).
CREATE TABLE IF NOT EXISTS science_project_materials (
  project_id BIGINT NOT NULL,
  material_id BIGINT NOT NULL,
  added_by BIGINT NOT NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, material_id),
  KEY idx_material (material_id),
  CONSTRAINT fk_science_pm_project FOREIGN KEY (project_id) REFERENCES science_projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_science_pm_material FOREIGN KEY (material_id) REFERENCES science_materials(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every job or object another module records against a project. Modules
-- register these through this module's /external API; module_id is the
-- calling module (taken from core's delegation, never from the request body).
CREATE TABLE IF NOT EXISTS science_project_items (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  module_id VARCHAR(64) NOT NULL,
  item_type VARCHAR(64) NOT NULL,
  item_id VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  status VARCHAR(64) NULL,
  link VARCHAR(512) NULL,
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_item (project_id, module_id, item_type, item_id),
  KEY idx_project (project_id),
  KEY idx_module_item (module_id, item_type, item_id),
  CONSTRAINT fk_science_items_project FOREIGN KEY (project_id) REFERENCES science_projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- "Request a project" (backend/services/requests.js). pending_user_id is the
-- requester while the request waits and NULL afterwards; being unique, it
-- allows one waiting request per person.
CREATE TABLE IF NOT EXISTS science_project_requests (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  requester_user_id BIGINT NOT NULL,
  pending_user_id BIGINT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  group_id BIGINT NULL,
  pi_user_id BIGINT NULL,
  status ENUM('pending','approved','declined','cancelled') NOT NULL DEFAULT 'pending',
  decided_by BIGINT NULL,
  decided_at TIMESTAMP NULL DEFAULT NULL,
  decision_note VARCHAR(1000) NULL,
  project_id BIGINT NULL,
  seen_by_requester TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pending (pending_user_id),
  KEY idx_requester (requester_user_id),
  KEY idx_status (status),
  CONSTRAINT fk_science_requests_project FOREIGN KEY (project_id) REFERENCES science_projects(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
