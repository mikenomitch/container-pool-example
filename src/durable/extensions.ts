import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';
import { migrate } from 'drizzle-orm/durable-sqlite/migrator';

interface MigrationConfig {
	journal: {
		entries: {
			idx: number;
			when: number;
			tag: string;
			breakpoints: boolean;
		}[];
	};
	migrations: Record<string, string>;
}

export abstract class DrizzleDurableObject<TSchema extends Record<string, unknown>, TEnv = unknown> extends DurableObject<TEnv> {
	#migrationsApplied = false;

	protected abstract readonly schema: TSchema;
	protected abstract readonly migrations: MigrationConfig;

	public async getDb() {
		const db = drizzle(this.ctx.storage, { schema: this.schema, logger: false });
		if (!this.#migrationsApplied) {
			await migrate(db, this.migrations);
			this.#migrationsApplied = true;
		}

		return db;
	}

	constructor(ctx: DurableObjectState, env: TEnv) {
		super(ctx, env);

		const originalDeleteAll = this.ctx.storage.deleteAll.bind(this.ctx.storage);
		this.ctx.storage.deleteAll = async (options?: DurableObjectPutOptions) => {
			originalDeleteAll(options);
			this.#migrationsApplied = false;
		};
	}
}
