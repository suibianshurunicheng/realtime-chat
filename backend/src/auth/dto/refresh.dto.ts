/**
 * Refresh uses the httpOnly refresh-token cookie + a (possibly expired) access token in
 * the Authorization header. No request body is required, so this is a marker DTO.
 */
export class RefreshDto {}
