import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

@Injectable()
export class ParseBigIntPipe implements PipeTransform<string, bigint> {
  transform(value: string, _metadata: ArgumentMetadata): bigint {
    try {
      if (!/^[1-9]\d{0,18}$/.test(value)) throw new Error();
      const id = BigInt(value);
      if (id > 9223372036854775807n) throw new Error();
      return id;
    } catch {
      throw new BadRequestException('id must be a valid integer');
    }
  }
}
