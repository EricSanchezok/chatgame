/**
 * Produces a detached, deeply read-only runtime view. Proxy traps throw
 * explicitly, so writes fail even when script code was compiled without
 * strict mode. Maps, arrays, plain objects, functions, and nested values all
 * stay behind the same mutation boundary.
 */
export function readonlySnapshot<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  const prior = seen.get(value as object);
  if (prior) return prior as T;
  const readOnly = (surface: string): never => {
    throw new TypeError(`extension ${surface} is read-only`);
  };

  if (value instanceof Map) {
    const target = new Map<unknown, unknown>();
    const proxy: Map<unknown, unknown> = new Proxy(target, {
      get(map, property) {
        if (property === "set" || property === "delete" || property === "clear") {
          return () => readOnly("maps");
        }
        if (property === "forEach") {
          return (callback: (entryValue: unknown, key: unknown, source: Map<unknown, unknown>) => void, thisArg?: unknown) =>
            map.forEach((entryValue, key) => callback.call(thisArg, entryValue, key, proxy));
        }
        const member = Reflect.get(map, property, map) as unknown;
        return typeof member === "function" ? member.bind(map) : member;
      },
      set() { return readOnly("maps"); },
      defineProperty() { return readOnly("maps"); },
      deleteProperty() { return readOnly("maps"); },
      setPrototypeOf() { return readOnly("maps"); },
      preventExtensions() { return readOnly("maps"); },
    });
    seen.set(value, proxy);
    for (const [key, entryValue] of value) {
      target.set(readonlySnapshot(key, seen), readonlySnapshot(entryValue, seen));
    }
    return proxy as T;
  }

  if (typeof value === "function") {
    const proxy = new Proxy(value, {
      get(fn, property, receiver) {
        return readonlySnapshot(Reflect.get(fn, property, receiver), seen);
      },
      set() { return readOnly("functions"); },
      defineProperty() { return readOnly("functions"); },
      deleteProperty() { return readOnly("functions"); },
      setPrototypeOf() { return readOnly("functions"); },
      preventExtensions() { return readOnly("functions"); },
    });
    seen.set(value, proxy);
    return proxy;
  }

  const clone: unknown[] | Record<PropertyKey, unknown> = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  const proxy = new Proxy(clone, {
    set() { return readOnly("snapshots"); },
    defineProperty() { return readOnly("snapshots"); },
    deleteProperty() { return readOnly("snapshots"); },
    setPrototypeOf() { return readOnly("snapshots"); },
    preventExtensions() { return readOnly("snapshots"); },
  });
  seen.set(value, proxy);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      writable: true,
      value: readonlySnapshot((value as Record<PropertyKey, unknown>)[key], seen),
    });
  }
  if (Array.isArray(value)) clone.length = value.length;
  return proxy as T;
}

/** Detaches extension output from any read-only proxy references it retained. */
export function mutableSnapshot<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return value;
  const prior = seen.get(value as object);
  if (prior) return prior as T;
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>();
    seen.set(value, clone);
    for (const [key, entryValue] of value) {
      clone.set(mutableSnapshot(key, seen), mutableSnapshot(entryValue, seen));
    }
    return clone as T;
  }
  if (typeof value === "function") return value;
  const clone: unknown[] | Record<PropertyKey, unknown> = Array.isArray(value)
    ? []
    : Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  seen.set(value, clone);
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    (clone as Record<PropertyKey, unknown>)[key] = mutableSnapshot(
      (value as Record<PropertyKey, unknown>)[key],
      seen,
    );
  }
  if (Array.isArray(value)) clone.length = value.length;
  return clone as T;
}
