/**
 * Logout is guarded by JwtAuthGuard and invalidates the refresh token in Redis.
 * No request body is required, so this is a marker DTO.
 */
export class LogoutDto {}
