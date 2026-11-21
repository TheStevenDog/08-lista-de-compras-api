/**
 * Mock en memoria de Firestore para pruebas unitarias e integración con Vitest.
 * Simula rutas jerárquicas (`usuarios/{uid}/lista/{id}`), `.create()` con error
 * ALREADY_EXISTS, consultas `.where()` / `.orderBy()` / `.limit()`, y rechaza
 * cualquier valor `undefined` igual que Firestore real.
 */

type DocData = Record<string, unknown>;

function assertNoUndefined(obj: unknown, pathLabel = "root"): void {
  if (obj === undefined) {
    throw new Error(`Firestore no acepta undefined en ${pathLabel}`);
  }
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      assertNoUndefined(v, `${pathLabel}.${k}`);
    }
  }
}

interface FilterCondition {
  field: string;
  op: "==" | ">" | ">=" | "<" | "<=";
  value: unknown;
}

export class InMemoryFirestore {
  public readonly store = new Map<string, DocData>();
  public forcedCreateCollisions = 0;

  clear(): void {
    this.store.clear();
    this.forcedCreateCollisions = 0;
  }

  collection(name: string) {
    return this.createCollectionRef(name);
  }

  private createDocRef(docPath: string) {
    const db = this;
    return {
      id: docPath.split("/").pop() ?? "",
      path: docPath,
      collection(subName: string) {
        return db.createCollectionRef(`${docPath}/${subName}`);
      },
      async get() {
        const data = db.store.get(docPath);
        return {
          id: docPath.split("/").pop() ?? "",
          exists: data !== undefined,
          data: () => (data ? structuredClone(data) : undefined),
        };
      },
      async set(data: DocData) {
        assertNoUndefined(data, docPath);
        db.store.set(docPath, structuredClone(data));
      },
      async update(partial: DocData) {
        assertNoUndefined(partial, docPath);
        const existing = db.store.get(docPath);
        if (!existing) {
          const err = new Error(`5 NOT_FOUND: ${docPath}`) as Error & { code: number };
          err.code = 5;
          throw err;
        }
        db.store.set(docPath, { ...existing, ...structuredClone(partial) });
      },
      async create(data: DocData) {
        assertNoUndefined(data, docPath);
        if (db.forcedCreateCollisions > 0) {
          db.forcedCreateCollisions -= 1;
          const err = new Error(`6 ALREADY_EXISTS: ${docPath}`) as Error & { code: number };
          err.code = 6;
          throw err;
        }
        if (db.store.has(docPath)) {
          const err = new Error(`6 ALREADY_EXISTS: ${docPath}`) as Error & { code: number };
          err.code = 6;
          throw err;
        }
        db.store.set(docPath, structuredClone(data));
      },
    };
  }

  private createCollectionRef(colPath: string) {
    const db = this;

    const buildQuery = (
      filters: FilterCondition[],
      orderField: string | null,
      orderDir: "asc" | "desc",
      limitCount: number | null
    ) => ({
      where(field: string, op: FilterCondition["op"], value: unknown) {
        return buildQuery([...filters, { field, op, value }], orderField, orderDir, limitCount);
      },
      orderBy(field: string, dir: "asc" | "desc" = "asc") {
        return buildQuery(filters, field, dir, limitCount);
      },
      limit(count: number) {
        return buildQuery(filters, orderField, orderDir, count);
      },
      async get() {
        const prefix = `${colPath}/`;
        let entries: Array<{ id: string; data: DocData }> = [];

        for (const [fullPath, data] of db.store.entries()) {
          if (!fullPath.startsWith(prefix)) continue;
          const remainder = fullPath.slice(prefix.length);
          // Solo documentos directos de esta colección (no subcolecciones)
          if (remainder.includes("/")) continue;
          entries.push({ id: remainder, data: structuredClone(data) });
        }

        for (const f of filters) {
          entries = entries.filter(({ data }) => {
            const v = data[f.field];
            if (f.op === "==") return v === f.value;
            if (typeof v === "string" && typeof f.value === "string") {
              if (f.op === ">") return v > f.value;
              if (f.op === ">=") return v >= f.value;
              if (f.op === "<") return v < f.value;
              if (f.op === "<=") return v <= f.value;
            }
            if (typeof v === "number" && typeof f.value === "number") {
              if (f.op === ">") return v > f.value;
              if (f.op === ">=") return v >= f.value;
              if (f.op === "<") return v < f.value;
              if (f.op === "<=") return v <= f.value;
            }
            return false;
          });
        }

        if (orderField) {
          entries.sort((a, b) => {
            const va = String(a.data[orderField] ?? "");
            const vb = String(b.data[orderField] ?? "");
            const cmp = va.localeCompare(vb);
            return orderDir === "asc" ? cmp : -cmp;
          });
        }

        if (limitCount !== null) {
          entries = entries.slice(0, limitCount);
        }

        const docs = entries.map((e) => ({
          id: e.id,
          exists: true,
          data: () => structuredClone(e.data),
        }));

        return {
          docs,
          size: docs.length,
          empty: docs.length === 0,
        };
      },
    });

    const rootQuery = buildQuery([], null, "asc", null);

    return {
      doc(id: string) {
        return db.createDocRef(`${colPath}/${id}`);
      },
      ...rootQuery,
    };
  }
}
