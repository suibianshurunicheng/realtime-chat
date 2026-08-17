import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 4: attachments table (1:N with messages).
 * - messageId nullable FK -> messages(id) ON DELETE CASCADE
 * - conversationId redundant copy for cheap membership-scoped download auth
 * - indexes: messageId (binding lookups), (conversationId, created_at)
 *   (history-by-conversation), expiresAt (orphan sweeper)
 */
export class CreateAttachments1786800000000 implements MigrationInterface {
  name = 'CreateAttachments1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE attachments (
        id BIGINT NOT NULL AUTO_INCREMENT,
        messageId BIGINT NULL,
        conversationId BIGINT NOT NULL,
        senderId BIGINT NOT NULL,
        kind VARCHAR(16) NOT NULL,
        fileName VARCHAR(255) NOT NULL,
        storageKey VARCHAR(255) NOT NULL,
        mimeType VARCHAR(127) NOT NULL,
        fileSize BIGINT NOT NULL,
        width INT NULL,
        height INT NULL,
        expires_at DATETIME(6) NULL,
        deleted_at DATETIME(6) NULL,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        CONSTRAINT FK_attachments_message FOREIGN KEY (messageId)
          REFERENCES messages (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await queryRunner.query(
      `CREATE INDEX IDX_attachments_messageId ON attachments (messageId);`,
    );
    await queryRunner.query(
      `CREATE INDEX IDX_attachments_conversation_created ON attachments (conversationId, created_at);`,
    );
    await queryRunner.query(
      `CREATE INDEX IDX_attachments_expiresAt ON attachments (expires_at);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS attachments;`);
  }
}
