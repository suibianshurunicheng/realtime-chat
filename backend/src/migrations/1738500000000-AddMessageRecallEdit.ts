import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3.5 (message recall + edit): adds `messages.recalled_at` and
 * `messages.edited_at` (both nullable datetime(6), default null).
 *
 * - `recalled_at`: set when the SENDER recalls the message. The original
 *   `content` row value is intentionally kept (audit trail); every public
 *   projection blanks it out, so no transport exposes the original text.
 * - `edited_at`: set when the SENDER edits the message. `content` is overwritten
 *   in place — no edit-history table is introduced (explicitly out of scope).
 *
 * No index is added: both columns are only ever read from an already-located row
 * (by primary key) and never used as a filter/sort predicate. Column names follow
 * project convention (timestamps use snake_case). Applied AFTER
 * AddMessageReadAt1738000000000.
 */
export class AddMessageRecallEdit1738500000000 implements MigrationInterface {
  name = 'AddMessageRecallEdit1738500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`messages\`
        ADD COLUMN \`recalled_at\` datetime(6) NULL DEFAULT NULL,
        ADD COLUMN \`edited_at\` datetime(6) NULL DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`messages\`
        DROP COLUMN \`edited_at\`,
        DROP COLUMN \`recalled_at\`
    `);
  }
}
