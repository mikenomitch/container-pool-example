import { Browsable } from '@outerbase/browsable-durable-object';
import { DrizzleDurableObject } from '../extensions';
import * as schema from './db/schema';
import migrations from './db/drizzle/migrations.js';
import { ContainerStatus } from './db/schema';
import { eq } from 'drizzle-orm';

@Browsable()
export class PoolManager extends DrizzleDurableObject<typeof schema, Env> {
	protected readonly schema = schema;
	protected readonly migrations = migrations;

	private readonly TARGET_INSTANCES = parseInt(this.env.POOL_TARGET_INSTANCES, 10);
	private readonly BATCH_SIZE = parseInt(this.env.POOL_BATCH_SIZE, 10);
	private readonly ALARM_DELAY = parseInt(this.env.POOL_BATCH_SPACING_IN_SECONDS, 10) * 1_000;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.ctx.blockConcurrencyWhile(async () => {
			await this.ctx.storage.deleteAlarm();
			await this.ctx.storage.setAlarm(Date.now());
		});
	}

	async reportStopped(id: string) {
		console.log(`Report Stopped container: ${id}`);
		const db = await this.getDb();
		await db.delete(schema.containers).where(eq(schema.containers.id, id));
		if (!(await this.ctx.storage.getAlarm())) {
			await this.ctx.storage.setAlarm(Date.now() + this.ALARM_DELAY);
		}
	}

	async reportRunning(id: string) {
		const db = await this.getDb();
		// if container is not in db (orphaned) destroy
		const instance = await db.query.containers.findFirst({
			columns: { id: true },
			where: eq(schema.containers.id, id),
		});

		if (!instance) {
			console.log(`Orphaned container: ${id}, destroying`);
			const containerId = this.env.POOL_CONTAINER.idFromString(id);
			const container = this.env.POOL_CONTAINER.get(containerId);
			await container.destroy();
		}
	}

	async getInstance({
		location,
		maxLifetimeInSeconds,
	}: {
		location?: DurableObjectLocationHint;
		maxLifetimeInSeconds?: number;
	}): Promise<string> {
		const db = await this.getDb();
		const instance = await db.query.containers.findFirst({
			columns: { id: true },
			where: eq(schema.containers.status, ContainerStatus.POOL),
		});

		let containerId;

		if (instance) {
			containerId = instance.id;
		} else {
			containerId = await this.startContainer(location);
		}

		await db
			.update(schema.containers)
			.set({ status: ContainerStatus.RELEASED, releasedAt: new Date() })
			.where(eq(schema.containers.id, containerId));

		if (!(await this.ctx.storage.getAlarm())) {
			await this.ctx.storage.setAlarm(Date.now() + this.ALARM_DELAY);
		}

		const id = this.env.POOL_CONTAINER.idFromString(containerId);
		const container = this.env.POOL_CONTAINER.get(id);
		await container.clearKeepAlive();

		// TODO: Debug call
		await container.setup('Hello from PoolManager');

		if (maxLifetimeInSeconds) {
			await container.setMaxLifetime(maxLifetimeInSeconds);
		}

		return container.id.toString();
	}

	public async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
		await this.maintainPool();
	}

	private async maintainPool() {
		const db = await this.getDb();
		const availableContainers = await db.$count(schema.containers, eq(schema.containers.status, ContainerStatus.POOL));

		if (availableContainers >= this.TARGET_INSTANCES) {
			return;
		}

		const num = Math.min(this.TARGET_INSTANCES - availableContainers, this.BATCH_SIZE);
		await Promise.all(new Array(num).fill(0).map(() => this.startContainer()));

		await this.ctx.storage.setAlarm(Date.now() + this.ALARM_DELAY);
	}

	async startContainer(location?: DurableObjectLocationHint) {
		console.log(`Attempting to start container in location: ${location}`);

		const containerId = this.env.POOL_CONTAINER.idFromName(`/container/${crypto.randomUUID()}`);

		try {
			const container = this.env.POOL_CONTAINER.get(containerId, { locationHint: location });
			const startTime = performance.now();
			await container.init(this.ctx.id.toString());
			const db = await this.getDb();
			await db.insert(schema.containers).values({
				id: containerId.toString(),
				status: ContainerStatus.POOL,
				startedAt: new Date(),
			});
			const endTime = performance.now();
			const duration = endTime - startTime;

			console.log(`Started container in ${duration}ms`, containerId.toString());
		} catch (error) {
			console.error(`Failed to start container`, error, containerId.toString());

			throw error;
		}

		return containerId.toString();
	}
}
