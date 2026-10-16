import { registerDecorator, ValidationOptions } from 'class-validator';

export function IsDatabaseId(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'isDatabaseId',
      target: target.constructor,
      propertyName: String(propertyKey),
      options,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            /^\d{1,19}$/.test(value) &&
            BigInt(value) > 0n &&
            BigInt(value) <= 9223372036854775807n
          );
        },
        defaultMessage() {
          return '$property must be a positive PostgreSQL BIGINT ID';
        },
      },
    });
}
