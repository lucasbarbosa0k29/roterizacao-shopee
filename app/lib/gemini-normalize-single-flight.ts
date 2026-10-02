export type GeminiNormalizeRequestIdentity = {
  model: string;
  address: string;
  bairro?: string;
  city?: string;
  cep?: string;
};

export function buildGeminiNormalizeRequestKey(input: GeminiNormalizeRequestIdentity) {
  return JSON.stringify([
    input.model,
    input.address,
    input.bairro || "",
    input.city || "",
    input.cep || "",
  ]);
}

export function getOrCreateJobSingleFlight<T>(args: {
  cache: Map<string, Promise<T>>;
  key: string;
  create: () => Promise<T>;
  isReusable: (result: T) => boolean;
}) {
  const existing = args.cache.get(args.key);
  if (existing) return existing;

  const promise = args.create();
  args.cache.set(args.key, promise);

  void promise.then(
    (result) => {
      if (!args.isReusable(result) && args.cache.get(args.key) === promise) {
        args.cache.delete(args.key);
      }
    },
    () => {
      if (args.cache.get(args.key) === promise) {
        args.cache.delete(args.key);
      }
    },
  );

  return promise;
}
