import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the friend system tables (Phase 2.1):
 *  - `friend_requests`: directed pending/accepted/rejected requests
 *  - `friendships`: established undirected relationships (one row per pair)
 *
 * Column names follow the project convention (entity property names; only the
 * timestamp columns are explicitly `created_at` / `updated_at`).
 *
 * Uniqueness is enforced at the DB level (not just in code):
 *  - UNIQUE(requesterId, addresseeId, pendingFlag): at most ONE pending
 *    request per directed pair (pendingFlag is NULL for accepted/rejected, and
 *    MySQL unique indexes ignore NULL, so history rows may coexist).
 *  - UNIQUE(userLow, userHigh): an A<->B friendship can never be duplicated.
 *
 * Applied AFTER the users baseline migration, so the `users(id)` FKs resolve.
 */
export class CreateFriendTables1737000000000 implements MigrationInterface {
  name = 'CreateFriendTables1737000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`friend_requests\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`requesterId\` bigint NOT NULL,
        \`addresseeId\` bigint NOT NULL,
        \`status\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
        \`pendingFlag\` tinyint GENERATED ALWAYS AS ((CASE WHEN \`status\` = 'pending' THEN 1 ELSE NULL END)) VIRTUAL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_friend_request_pending\` (\`requesterId\`, \`addresseeId\`, \`pendingFlag\`),
        KEY \`idx_friend_request_addressee\` (\`addresseeId\`, \`status\`),
        CONSTRAINT \`fk_friend_request_requester\` FOREIGN KEY (\`requesterId\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_friend_request_addressee\` FOREIGN KEY (\`addresseeId\`) REFERENCES \`users\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`friendships\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`userId\` bigint NOT NULL,
        \`friendId\` bigint NOT NULL,
        \`userLow\` bigint GENERATED ALWAYS AS (LEAST(\`userId\`, \`friendId\`)) STORED,
        \`userHigh\` bigint GENERATED ALWAYS AS (GREATEST(\`userId\`, \`friendId\`)) STORED,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_friendship_pair\` (\`userLow\`, \`userHigh\`),
        KEY \`idx_friendship_user\` (\`userId\`),
        CONSTRAINT \`fk_friendship_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`),
        CONSTRAINT \`fk_friendship_friend\` FOREIGN KEY (\`friendId\`) REFERENCES \`users\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`friendships\``);
    await queryRunner.query(`DROP TABLE \`friend_requests\``);
  }
}
