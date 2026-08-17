/**
 * Minimal ambient declaration for `Express.Multer.File` (the shape multer
 * hands to `@UploadedFile()`). Avoids pulling in `@types/multer` as a dependency —
 * we only need the fields we actually read. `@nestjs/common` references this type
 * for the `@UploadedFile()` decorator, so it must exist in the global scope.
 */
declare namespace Express {
  namespace Multer {
    interface File {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
      destination?: string;
      filename?: string;
      path?: string;
      stream?: import('stream').Readable;
    }
  }
}
