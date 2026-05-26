import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Optional request body for the POST /auth/refresh endpoint.
 * Mobile / non-browser clients that cannot use HttpOnly cookies
 * should send the refresh token here instead.
 */
export class RefreshTokenBodyDto {
  @ApiProperty({
    description: 'Refresh token (mobile/non-browser clients only)',
    required: false,
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
