import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AppConfig } from '../config/configuration';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly token: TokenService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  private setRefreshCookie(res: Response, refreshToken: string): void {
    const name = this.config.get('refreshCookie.name', { infer: true })!;
    const secure = this.config.get('refreshCookie.secure', { infer: true }) ?? false;
    const ttlDays = this.config.get('jwt.refreshExpiresInDays', { infer: true }) ?? 7;
    res.cookie(name, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: ttlDays * 86400000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    const name = this.config.get('refreshCookie.name', { infer: true })!;
    res.clearCookie(name, { path: '/' });
  }

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const name = this.config.get('refreshCookie.name', { infer: true })!;
    const refreshToken = req.cookies?.[name] as string | undefined;
    if (!refreshToken) {
      throw new UnauthorizedException('缺少 refresh token');
    }
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const decoded = this.token.decodeExpired(accessToken);
    const userId = decoded?.sub;
    const sid = decoded?.sid;
    if (!userId || !sid) {
      throw new UnauthorizedException('无效或缺失 access token');
    }
    const result = await this.auth.refresh(userId, sid, refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = req.user as { sub: string; jti: string; sid: string; exp?: number };
    const nowSec = Math.floor(Date.now() / 1000);
    const ttlSeconds = user.exp ? Math.max(0, user.exp - nowSec) : 900;
    await this.auth.logout(user.sub, user.sid, user.jti, ttlSeconds);
    this.clearRefreshCookie(res);
    return { success: true };
  }
}
