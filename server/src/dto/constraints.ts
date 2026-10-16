import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import {
  validateChannelDescription,
  validateChannelId,
  validateChannelName,
  validateMessageBody,
  validatePassword,
  validateUsername,
} from '../validators';

function checked(result: { ok: boolean }): boolean {
  return result.ok;
}

@ValidatorConstraint({ name: 'username', async: false })
export class UsernameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checked(validateUsername(value));
  }

  defaultMessage(): string {
    return 'invalid_username';
  }
}

@ValidatorConstraint({ name: 'password', async: false })
export class PasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checked(validatePassword(value));
  }

  defaultMessage(): string {
    return 'invalid_password';
  }
}

@ValidatorConstraint({ name: 'channelId', async: false })
export class ChannelIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checked(validateChannelId(value));
  }

  defaultMessage(): string {
    return 'invalid_channel_id';
  }
}

@ValidatorConstraint({ name: 'channelName', async: false })
export class ChannelNameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checked(validateChannelName(value));
  }

  defaultMessage(): string {
    return 'invalid_channel_name';
  }
}

@ValidatorConstraint({ name: 'channelDescription', async: false })
export class ChannelDescriptionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checked(validateChannelDescription(value));
  }

  defaultMessage(): string {
    return 'invalid_channel_description';
  }
}

@ValidatorConstraint({ name: 'messageBody', async: false })
export class MessageBodyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return checked(validateMessageBody(value));
  }

  defaultMessage(): string {
    return 'invalid_message_body';
  }
}

@ValidatorConstraint({ name: 'recipientUserId', async: false })
export class RecipientConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    let count = 0;
    for (const _character of value) {
      count += 1;
      if (count > 0) return true;
    }
    return false;
  }

  defaultMessage(): string {
    return 'invalid_recipient';
  }
}

@ValidatorConstraint({ name: 'memberQuery', async: false })
export class MemberQueryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    let count = 0;
    for (const _character of value) {
      count += 1;
      if (count > 0) return true;
    }
    return false;
  }

  defaultMessage(): string {
    return 'invalid_query';
  }
}
