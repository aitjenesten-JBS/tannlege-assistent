import { Redis } from "@upstash/redis";

// Upstash Redis når nøklene finnes, ellers minne (lokal utvikling og tester).
// Minnelageret overlever hot reload via globalThis, men ikke omstart.

export interface Lager {
  hent<T>(nokkel: string): Promise<T | null>;
  lagre(nokkel: string, verdi: unknown, ttlSek?: number): Promise<void>;
  leggTilListe(nokkel: string, verdi: unknown): Promise<void>;
  hentListe<T>(nokkel: string): Promise<T[]>;
  slett(nokkel: string): Promise<void>;
}

type Minne = { kv: Map<string, { verdi: unknown; utloper?: number }>; lister: Map<string, unknown[]> };

function minnelager(): Lager {
  const g = globalThis as unknown as { __tannlegeMinne?: Minne };
  g.__tannlegeMinne ??= { kv: new Map(), lister: new Map() };
  const m = g.__tannlegeMinne;
  const kopi = <T>(v: unknown) => structuredClone(v) as T;

  return {
    async hent<T>(nokkel: string) {
      const rad = m.kv.get(nokkel);
      if (!rad) return null;
      if (rad.utloper && rad.utloper < Date.now()) {
        m.kv.delete(nokkel);
        return null;
      }
      return kopi<T>(rad.verdi);
    },
    async lagre(nokkel, verdi, ttlSek) {
      m.kv.set(nokkel, { verdi: kopi(verdi), utloper: ttlSek ? Date.now() + ttlSek * 1000 : undefined });
    },
    async leggTilListe(nokkel, verdi) {
      const liste = m.lister.get(nokkel) ?? [];
      liste.push(kopi(verdi));
      m.lister.set(nokkel, liste);
    },
    async hentListe<T>(nokkel: string) {
      return kopi<T[]>(m.lister.get(nokkel) ?? []);
    },
    async slett(nokkel) {
      m.kv.delete(nokkel);
      m.lister.delete(nokkel);
    },
  };
}

function redislager(redis: Redis): Lager {
  return {
    async hent<T>(nokkel: string) {
      return (await redis.get<T>(nokkel)) ?? null;
    },
    async lagre(nokkel, verdi, ttlSek) {
      if (ttlSek) await redis.set(nokkel, verdi, { ex: ttlSek });
      else await redis.set(nokkel, verdi);
    },
    async leggTilListe(nokkel, verdi) {
      await redis.rpush(nokkel, verdi);
    },
    async hentListe<T>(nokkel: string) {
      return redis.lrange<T>(nokkel, 0, -1);
    },
    async slett(nokkel) {
      await redis.del(nokkel);
    },
  };
}

let lager: Lager | undefined;

export function hentLager(): Lager {
  if (!lager) {
    const harRedis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
    lager = harRedis ? redislager(Redis.fromEnv()) : minnelager();
  }
  return lager;
}

export function harRedis(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
