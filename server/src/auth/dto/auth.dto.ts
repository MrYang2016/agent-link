import { ApiProperty } from '@nestjs/swagger';
import { Validate } from 'class-validator';
import { PasswordConstraint, UsernameConstraint } from '../../dto/constraints';

export class RegisterDto {
  @ApiProperty({ description: '用户名' })
  @Validate(UsernameConstraint)
  username: string;

  @ApiProperty({ description: '密码' })
  @Validate(PasswordConstraint)
  password: string;
}

export class LoginDto {
  @ApiProperty({ description: '用户名' })
  @Validate(UsernameConstraint)
  username: string;

  @ApiProperty({ description: '密码' })
  @Validate(PasswordConstraint)
  password: string;
}
