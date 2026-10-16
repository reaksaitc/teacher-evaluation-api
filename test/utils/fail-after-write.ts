import { PrismaService } from '../../src/prisma/prisma.service';

/** Inject a late failure while all reads/writes still use the real PostgreSQL transaction. */
export function failAfterWrite(
  prisma: PrismaService,
  model: string,
  method: string,
  occurrence: number,
): PrismaService {
  let calls = 0;
  return new Proxy(prisma, {
    get(target, property) {
      if (property === '$transaction')
        return (operation: any, options: any) =>
          target.$transaction(
            async (tx) =>
              operation(
                new Proxy(tx, {
                  get(client, delegate) {
                    const value = Reflect.get(client, delegate);
                    if (delegate !== model)
                      return typeof value === 'function'
                        ? value.bind(client)
                        : value;
                    return new Proxy(value, {
                      get(table, action) {
                        const fn = Reflect.get(table, action);
                        if (action !== method)
                          return typeof fn === 'function' ? fn.bind(table) : fn;
                        return async (...args: unknown[]) => {
                          const result = await fn.apply(table, args);
                          if (++calls === occurrence)
                            throw new Error('INJECTED_LATE_WRITE_FAILURE');
                          return result;
                        };
                      },
                    });
                  },
                }),
              ),
            options,
          );
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
