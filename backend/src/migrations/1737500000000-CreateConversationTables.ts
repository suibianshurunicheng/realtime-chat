import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the conversation / message tables (Phase 2.2A):
 *  - `conversations`:       chat container; UNIQUE(userLow, userHigh) dedups 1:1 pairs
 *  - `conversation_members`: per-user membership; UNIQUE(conversationId, userId)
 *  - `messages`:            text messages; FK to conversations + users, indexed for pagination
 *
 * Column names follow the project convention (entity property names; only
 * `created_at`/`updated_at` are explicitly snake_case). Applied AFTER the users
 * and friend-table migrations so the `users(id)` FKs resolve.
 *
 * Uniqueness is enforced at the DB level (not just in code):
 *  - conversations.uq_conversation_pair (userLow, userHigh): A<->B can never
 *    spawn two conversations, even under concurrent creation.
 *  - conversation_members.uq_member_conv_user (conversationId, userId): a user
 *    is never a member twice.
 */
export class CreateConversationTables1737500000000 implements MigrationInterface {
  name = 'CreateConversationTables1737500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`conversations\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`type\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'direct',
        \`userLow\` bigint DEFAULT NULL,
        \`userHigh\` bigint DEFAULT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_conversation_pair\` (\`userLow\`, \`userHigh\`),
        KEY \`idx_conversation_user\` (\`userLow\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`conversation_members\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`conversationId\` bigint NOT NULL,
        \`userId\` bigint NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uq_member_conv_user\` (\`conversationId\`, \`userId\`),
        KEY \`idx_member_user\` (\`userId\`),
        CONSTRAINT \`fk_member_conversation\` FOREIGN KEY (\`conversationId\`) REFERENCES \`conversations\` (\`id\`),
        CONSTRAINT \`fk_member_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE \`messages\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`conversationId\` bigint NOT NULL,
        \`senderId\` bigint NOT NULL,
        \`type\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'text',
        \`content\` text COLLATE utf8mb4_unicode_ci NOT NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_message_conv_created\` (\`conversationId\`, \`created_at\`),
        CONSTRAINT \`fk_message_conversation\` FOREIGN KEY (\`conversationId\`) REFERENCES \`conversations\` (\`id\`),
        CONSTRAINT \`fk_message_sender\` FOREIGN KEY (\`senderId\`) REFERENCES \`users\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`messages\``);
    await queryRunner.query(`DROP TABLE \`conversation_members\``);
    await queryRunner.query(`DROP TABLE \`conversations\``);
  }
}
