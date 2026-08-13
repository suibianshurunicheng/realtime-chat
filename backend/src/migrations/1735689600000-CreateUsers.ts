import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline migration: creates the `users` table to exactly match the
 * User entity (src/users/entities/user.entity.ts). Generated to mirror the
 * schema that `synchronize` previously produced, so switching to migrations
 * is a no-op for existing data.
 */
export class CreateUsers1735689600000 implements MigrationInterface {
  name = 'CreateUsers1735689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`username\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`passwordHash\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`nickname\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`avatar\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`status\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_fe0bb3f6520ee0469504521e71\` (\`username\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`users\``);
  }
}
