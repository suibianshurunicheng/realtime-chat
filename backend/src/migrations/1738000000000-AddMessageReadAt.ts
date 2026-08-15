import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.4 (read receipts): adds `messages.read_at` (nullable datetime(6)).
 *
 * Records when the message's recipient read it. The existing 1:1 model makes a
 * single column sufficient (recipient = the non-sender member) — no separate
 * `message_reads` table is introduced (that remains reserved for future group
 * chat). The composite index (conversationId, read_at) supports the markRead
 * UPDATE (`WHERE conversationId = ? AND senderId != ? AND read_at IS NULL`).
 *
 * Column name follows project convention (entity property `readAt` -> snake
 * `read_at`; only timestamps use snake_case). Applied AFTER the conversation
 * tables migration.
 */
export class AddMessageReadAt1738000000000 implements MigrationInterface {
  name = 'AddMessageReadAt1738000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`messages\`
        ADD COLUMN \`read_at\` datetime(6) NULL DEFAULT NULL,
        ADD KEY \`idx_message_read\` (\`conversationId\`, \`read_at\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`messages\`
        DROP KEY \`idx_message_read\`,
        DROP COLUMN \`read_at\`
    `);
  }
}
