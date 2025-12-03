import { integer, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

export enum ContainerStatus {
	POOL = 0,
	RELEASED = 1,
}

export const containers = sqliteTable(
	'containers',
	{
		id: text('id').primaryKey(),
		status: integer('status').notNull().default(ContainerStatus.POOL),
		startedAt: integer({ mode: 'timestamp_ms' }).notNull(),
		releasedAt: integer({ mode: 'timestamp_ms' }),
	},
	(table) => [index('status_idx').on(table.status)]
);
