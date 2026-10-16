import { Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import {
  validateChannelDescription,
  validateChannelId,
  validateChannelName,
  validateMessageBody,
  validatePassword,
  validateUsername,
} from '../validators';

@ValidatorConstraint({ name: 'agentLinkUsername', async: false })
export class UsernameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateUsername(value).ok;
  }

  defaultMessage(): string {
    return 'invalid_username';
  }
}

@ValidatorConstraint({ name: 'agentLinkPassword', async: false })
export class PasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validatePassword(value).ok;
  }

  defaultMessage(): string {
    return 'invalid_password';
  }
}

@ValidatorConstraint({ name: 'agentLinkChannelId', async: false })
export class ChannelIdConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateChannelId(value).ok;
  }

  defaultMessage(): string {
    return 'invalid_channel_id';
  }
}

@ValidatorConstraint({ name: 'agentLinkChannelName', async: false })
export class ChannelNameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateChannelName(value).ok;
  }

  defaultMessage(): string {
    return 'invalid_channel_name';
  }
}

@ValidatorConstraint({ name: 'agentLinkChannelDescription', async: false })
export class ChannelDescriptionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateChannelDescription(value).ok;
  }

  defaultMessage(): string {
    return 'invalid_channel_description';
  }
}

@ValidatorConstraint({ name: 'agentLinkMessageBody', async: false })
export class MessageBodyConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return validateMessageBody(value).ok;
  }

  defaultMessage(): string {
    return 'invalid_message_body';
  }
}

@ValidatorConstraint({ name: 'agentLinkRecipient', async: false })
export class RecipientConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    let count = 0;
    for (const _character of value) count += 1;
    return count > 0;
  }

  defaultMessage(): string {
    return 'invalid_recipient';
  }
}

@ValidatorConstraint({ name: 'agentLinkMemberQuery', async: false })
export class MemberQueryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    let count = 0;
    for (const _character of value) count += 1;
    return count > 0;
  }

  defaultMessage(): string {
    return 'invalid_query';
  }
}

export const UsernameField = () => Validate(UsernameConstraint);
export const PasswordField = () => Validate(PasswordConstraint);
export const ChannelIdField = () => Validate(ChannelIdConstraint);
export const ChannelNameField = () => Validate(ChannelNameConstraint);
export const ChannelDescriptionField = () => Validate(ChannelDescriptionConstraint);
export const MessageBodyField = () => Validate(MessageBodyConstraint);
export const RecipientField = () => Validate(RecipientConstraint);
export const MemberQueryField = () => Validate(MemberQueryConstraint);
